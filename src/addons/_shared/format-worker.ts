import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Markdoc from '@markdoc/markdoc'
import { compile as compileMdx, createProcessor } from '@mdx-js/mdx'
import { build, stop } from 'esbuild'
import { toHtml } from 'hast-util-to-html'
import { toHast } from 'mdast-util-to-hast'
import { compile as compileMdsvex } from 'mdsvex'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
import * as svelteRuntime from 'svelte'
import 'svelte/internal/flags/legacy'
import { compile as compileSvelte } from 'svelte/compiler'
// @ts-expect-error Svelte's generated server runtime has no declaration file.
import * as svelteInternal from 'svelte/internal/server'
import { render as renderSvelte } from 'svelte/server'
import type { FormatResult, FormatSpec } from './format-specs'

export type FormatJob = {
  spec: FormatSpec
  source: string
  scratch: string
  entry: string
  run: boolean
  tools?: boolean
}
const limit = 20 * 1024 * 1024
const searchPath = [
  ...new Set([
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/miniconda3/bin',
    '/Library/TeX/texbin',
  ]),
].filter(isAbsolute)

async function tool(name: string) {
  for (const directory of searchPath) {
    for (const filename of process.platform === 'win32'
      ? [`${name}.exe`, ...(name === 'quarto' ? ['quarto.cmd'] : [])]
      : [name]) {
      const path = join(directory, filename)
      try {
        await access(path, constants.X_OK)
        return path
      } catch {
        /* Try the next installation. */
      }
    }
  }
  throw new Error(`Install ${name} and add it to PATH, then restart Hibi.`)
}

async function command(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
) {
  let executable = await tool(name)
  let verbatim = false
  if (process.platform === 'win32' && executable.endsWith('.cmd')) {
    if ([executable, ...args].some((value) => /["\r\n%!?^&|<>()]/.test(value)))
      throw new Error(
        'Quarto’s Windows launcher needs a path without shell punctuation. Move the document to a simpler folder name.',
      )
    args = [
      '/d',
      '/s',
      '/c',
      `"${[executable, ...args].map((value) => `"${value}"`).join(' ')}"`,
    ]
    executable =
      process.env.ComSpec ??
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    verbatim = true
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
      env: { ...process.env, PATH: searchPath.join(delimiter) },
    })
    if (child.pid) process.parentPort.postMessage({ child: child.pid })
    let stdout = '',
      stderr = '',
      size = 0
    const collect = (chunk: Buffer, error: boolean) => {
      size += chunk.byteLength
      if (size > limit) {
        child.kill('SIGKILL')
        reject(new Error('Compiler output exceeds 20 MiB.'))
      } else if (error) stderr += chunk.toString()
      else stdout += chunk.toString()
    }
    child.stdout.on('data', (chunk) => collect(chunk, false))
    child.stderr.on('data', (chunk) => collect(chunk, true))
    child.stdin.on('error', () => {})
    child.once('error', reject)
    child.once('close', () =>
      process.parentPort.postMessage({ closedChild: child.pid }),
    )
    child.once('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(
              (stderr || stdout || `${name} stopped (${code}).`).slice(-6000),
            ),
          ),
    )
    child.stdin.end(input)
  })
}

async function output(path: string) {
  if ((await stat(path)).size > 64 * 1024 * 1024)
    throw new Error('Compiled output exceeds 64 MiB.')
  return readFile(path)
}

async function preview(job: FormatJob): Promise<FormatResult> {
  const { source, spec } = job
  if (spec.reader === 'html') return { html: source }
  if (spec.reader === 'mdx') {
    const tree = createProcessor({ remarkPlugins: [remarkGfm] }).parse(source)
    type Node = {
      type: string
      value?: string | undefined
      children?: Node[] | undefined
      position?:
        | {
            start: { offset?: number | undefined }
            end: { offset?: number | undefined }
          }
        | undefined
    }
    const inert = (node: Node): Node => {
      if (node.type.startsWith('mdx'))
        return {
          type: /Text/.test(node.type) ? 'inlineCode' : 'code',
          value: source.slice(
            node.position?.start.offset,
            node.position?.end.offset,
          ),
        }
      if (node.children) node.children = node.children.map(inert)
      return node
    }
    inert(tree)
    return { html: toHtml(toHast(tree)!) }
  }
  if (spec.reader === 'mdsvex') {
    const result = await compileMdsvex(source, {
      filename: job.entry,
      highlight: false,
    })
    if (!result) throw new Error('MDsveX could not parse this document.')
    return { html: result.code }
  }
  if (spec.reader === 'markdoc') {
    const ast = Markdoc.parse(source)
    const errors = Markdoc.validate(ast).filter(
      (item) => item.error.level === 'critical',
    )
    if (errors.length)
      throw new Error(errors.map((item) => item.error.message).join('\n'))
    return { html: Markdoc.renderers.html(Markdoc.transform(ast)) }
  }
  return {
    html: await command(
      'pandoc',
      [
        '--sandbox',
        '--from',
        spec.reader,
        '--to',
        'html5',
        '--standalone',
        '--metadata=pagetitle:Hibi document',
        '--mathml',
        '--syntax-highlighting=none',
      ],
      job.scratch,
      source,
    ),
  }
}

async function componentSource(source: string, path: string) {
  if (/\.mdx$/i.test(path))
    return String(
      await compileMdx({ value: source, path }, { remarkPlugins: [remarkGfm] }),
    )
  if (/\.svx$/i.test(path)) {
    const result = await compileMdsvex(source, {
      filename: path,
      highlight: false,
    })
    if (!result) throw new Error('MDsveX could not compile this document.')
    source = result.code
  }
  return compileSvelte(source, {
    filename: path,
    generate: 'server',
    css: 'injected',
  }).js.code
}

async function runComponent(job: FormatJob): Promise<FormatResult> {
  // Only explicit Run reaches this function. No document code executes during preview.
  process.chdir(dirname(job.entry))
  const runtimes: Record<string, object> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    svelte: svelteRuntime,
    'svelte/internal/server': svelteInternal,
    'svelte/server': { render: renderSvelte },
  }
  Object.assign(globalThis, { __hibiDocumentRuntime: runtimes })
  const bundled = await build({
    stdin: {
      contents: await componentSource(job.source, job.entry),
      sourcefile: job.entry,
      resolveDir: dirname(job.entry),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    plugins: [
      {
        name: 'document-components',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(react(?:\/jsx-runtime)?|svelte(?:\/internal\/server|\/server)?)$/,
            },
            (args) => ({ path: args.path, namespace: 'hibi-runtime' }),
          )
          builder.onLoad(
            { filter: /.*/, namespace: 'hibi-runtime' },
            (args) => ({
              contents:
                Object.keys(runtimes[args.path]!)
                  .filter(
                    (name) =>
                      name !== 'default' && /^[a-zA-Z_$][\w$]*$/.test(name),
                  )
                  .map(
                    (name, index) =>
                      `const runtime${index}=globalThis.__hibiDocumentRuntime[${JSON.stringify(args.path)}][${JSON.stringify(name)}];export {runtime${index} as ${name}};`,
                  )
                  .join('\n') +
                `\nexport default globalThis.__hibiDocumentRuntime[${JSON.stringify(args.path)}];`,
              loader: 'js',
            }),
          )
          builder.onLoad({ filter: /\.(mdx|svx|svelte)$/ }, async (args) => ({
            contents: await componentSource(
              await readFile(args.path, 'utf8'),
              args.path,
            ),
            loader: 'js',
            resolveDir: dirname(args.path),
          }))
          builder.onResolve(
            { filter: /^svelte\/internal\/flags\/legacy$/ },
            (args) => ({ path: args.path, namespace: 'hibi-legacy' }),
          )
          builder.onLoad({ filter: /.*/, namespace: 'hibi-legacy' }, () => ({
            contents: '',
            loader: 'js',
          }))
          builder.onResolve({ filter: /^[\w@]/ }, (args) => {
            const path = createRequire(args.importer || job.entry).resolve(
              args.path,
            )
            return { path, external: !isAbsolute(path) }
          })
        },
      },
    ],
  })
  const modulePath = join(job.scratch, 'document.mjs')
  await writeFile(modulePath, bundled.outputFiles[0]!.text)
  const module = await import(/* @vite-ignore */ pathToFileURL(modulePath).href)
  if (job.spec.engine === 'mdx')
    return { html: renderToStaticMarkup(React.createElement(module.default)) }
  const rendered = renderSvelte(module.default)
  return { html: rendered.head + rendered.body }
}

async function run(job: FormatJob): Promise<FormatResult> {
  const cwd = dirname(job.entry)
  if (job.spec.engine === 'mdx' || job.spec.engine === 'mdsvex')
    return runComponent(job)
  if (job.spec.engine === 'latex') {
    await command(
      'tectonic',
      ['-X', 'compile', '--untrusted', '--outdir', job.scratch, job.entry],
      cwd,
    )
    return {
      pdf: await output(
        join(job.scratch, basename(job.entry).replace(/\.tex$/i, '.pdf')),
      ),
    }
  }
  if (job.spec.engine === 'quarto') {
    await command(
      'quarto',
      [
        'render',
        job.entry,
        '--to',
        'html',
        '--embed-resources',
        '--execute',
        '--output',
        'rendered.html',
        '--output-dir',
        job.scratch,
      ],
      cwd,
    )
  } else if (job.spec.engine === 'rmarkdown') {
    await command(
      'Rscript',
      [
        '--vanilla',
        '-e',
        'a <- commandArgs(TRUE); rmarkdown::render(a[1], output_format="html_document", output_file="rendered.html", output_dir=a[2], knit_root_dir=a[3], quiet=TRUE, envir=new.env())',
        job.entry,
        job.scratch,
        cwd,
      ],
      cwd,
    )
  } else return preview(job)
  return {
    html: (await output(join(job.scratch, 'rendered.html'))).toString('utf8'),
  }
}

process.parentPort.once(
  'message',
  async ({ data: job }: { data: FormatJob }) => {
    try {
      if (job.tools) {
        const names = [
          ...new Set([
            ...(['html', 'mdx', 'mdsvex', 'markdoc'].includes(job.spec.reader)
              ? []
              : ['pandoc']),
            ...(job.spec.engine === 'latex'
              ? ['tectonic']
              : job.spec.engine === 'rmarkdown'
                ? ['Rscript']
                : job.spec.engine === 'quarto'
                  ? ['quarto']
                  : []),
          ]),
        ]
        const status = await Promise.all(
          names.map(async (name) => {
            try {
              const path = await tool(name)
              return `${name}: ${path}`
            } catch (error) {
              return (error as Error).message
            }
          }),
        )
        process.parentPort.postMessage({
          result: {
            diagnostics: status.join('\n') || 'Renderer bundled with Hibi.',
          },
        })
      } else {
        const result = await (job.run ? run(job) : preview(job))
        if (result.html && Buffer.byteLength(result.html) > limit)
          throw new Error('Rendered document exceeds 20 MiB.')
        process.parentPort.postMessage({ result })
      }
    } catch (error) {
      process.parentPort.postMessage({
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      stop()
    }
  },
)
