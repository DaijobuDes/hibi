import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { app, utilityProcess } from 'electron'
import type { AddonManifest, NativeAddon, NativeAddonContext } from '../api'
import { documentProject } from './document-project'
import { type FormatResult, formatSpec } from './format-specs'
import type { FormatJob } from './format-worker'

const active = new Set<() => void>()
app.on('before-quit', () => {
  for (const cancel of active) cancel()
})
type Input = {
  source: string
  documentId?: string
  kind?: 'html' | 'pdf'
  html?: string
  export?: boolean
}
function input(value: unknown): Input {
  const data = value as Input | null
  if (
    !data ||
    typeof data.source !== 'string' ||
    Buffer.byteLength(data.source) > 2 * 1024 * 1024 ||
    (data.export !== undefined && typeof data.export !== 'boolean') ||
    (data.documentId !== undefined &&
      (typeof data.documentId !== 'string' || data.documentId.length > 128))
  )
    throw new Error('Invalid document input.')
  return data
}

export function nativeFormat(manifest: AddonManifest): NativeAddon {
  const spec = formatSpec(manifest)
  const owned = new Set<() => void>()
  let cached: { key: string; result: FormatResult } | undefined
  let runningPreview: (() => void) | undefined
  const key = (data: Input) => JSON.stringify([data.documentId, data.source])
  async function execute(
    data: Input,
    context: NativeAddonContext,
    run = false,
    tools = false,
  ) {
    const note = await context.document.path(data.documentId)
    const scratch = await mkdtemp(join(tmpdir(), 'hibi-format-'))
    // Explicit runs use a temporary sibling source so relative project imports keep working.
    const entry = join(
      run && note ? dirname(note) : scratch,
      `.hibi-run-${randomUUID()}.${spec.extensions[0]}`,
    )
    let cancel: (() => void) | undefined
    try {
      if (run) await writeFile(entry, data.source, { flag: 'wx', mode: 0o600 })
      const worker = utilityProcess.fork(
        join(app.getAppPath(), 'out/main/format-worker.js'),
        [],
        {
          serviceName: `hibi ${spec.name}`,
          stdio: 'pipe',
          ...(app.isPackaged
            ? {
                env: {
                  ...process.env,
                  ESBUILD_BINARY_PATH: createRequire(import.meta.url)
                    .resolve(
                      `@esbuild/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`,
                    )
                    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
                },
              }
            : {}),
        },
      )
      const children = new Set<number>()
      worker.stdout?.on('data', () => {})
      worker.stderr?.on('data', () => {})
      return await new Promise<FormatResult>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error, result?: FormatResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          for (const pid of children) {
            try {
              if (process.platform === 'win32')
                spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
                  windowsHide: true,
                  stdio: 'ignore',
                })
              else process.kill(-pid, 'SIGKILL')
            } catch {
              /* The compiler already exited. */
            }
          }
          if (worker.pid) {
            try {
              process.kill(worker.pid, 'SIGKILL')
            } catch {
              worker.kill()
            }
          } else worker.kill()
          if (error) reject(error)
          else resolve(result ?? {})
        }
        cancel = () => finish(new Error('Document rendering canceled.'))
        owned.add(cancel)
        active.add(cancel)
        if (!run && !tools && !data.export) {
          runningPreview?.()
          runningPreview = cancel
        }
        const timer = setTimeout(
          () =>
            finish(new Error(`Rendering exceeded ${run ? 90 : 15} seconds.`)),
          run ? 90000 : 15000,
        )
        worker.once('error', (error) => finish(new Error(String(error))))
        worker.once('exit', () =>
          finish(new Error('Document renderer stopped. Try again.')),
        )
        worker.on(
          'message',
          (message: {
            child?: number
            closedChild?: number
            result?: FormatResult
            error?: string
          }) => {
            if (
              message.child &&
              Number.isSafeInteger(message.child) &&
              message.child > 0
            )
              children.add(message.child)
            else if (message.closedChild) children.delete(message.closedChild)
            else if (message.error) finish(new Error(message.error))
            else if (message.result) finish(undefined, message.result)
          },
        )
        worker.postMessage({
          spec,
          source: data.source,
          scratch,
          entry,
          run,
          tools,
        } satisfies FormatJob)
      })
    } finally {
      if (cancel) {
        owned.delete(cancel)
        active.delete(cancel)
        if (runningPreview === cancel) runningPreview = undefined
      }
      if (run) await rm(entry, { force: true })
      await rm(scratch, { recursive: true, force: true })
    }
  }
  const current = (data: Input, context: NativeAddonContext) => {
    const document = context.document.get()
    if (document.id !== data.documentId || document.markdown !== data.source)
      throw new Error('The document changed. Run the current version again.')
    return document
  }
  return {
    id: spec.id,
    stop() {
      for (const cancel of owned) cancel()
      cached = undefined
    },
    queries: {
      async render(value, context) {
        const data = input(value)
        if (cached?.key === key(data)) return cached.result
        const result = await execute(data, context)
        return result
      },
      tools: (_value, context) => execute({ source: '' }, context, false, true),
      async image(value, context) {
        const data = value as { source?: string; documentId?: string }
        if (
          typeof data?.source !== 'string' ||
          data.source.length > 4096 ||
          typeof data.documentId !== 'string'
        )
          throw new Error('Invalid image path.')
        const allowed = /\.(png|jpe?g|gif|webp|svg|avif)$/i
        const location = await documentProject(context, {
          id: data.documentId,
          entry: '',
          allowed,
          paths: [],
        })
        if (!location.root) return null
        const name = join(
          dirname(location.entry),
          decodeURIComponent(data.source.split(/[?#]/)[0]!),
        )
        const project = await documentProject(context, {
          id: data.documentId,
          entry: '',
          allowed,
          paths: [name],
        })
        const file = project.files?.[0]
        if (!file || file[1].byteLength > 8 * 1024 * 1024) return null
        const extension = extname(file[0]).slice(1).toLowerCase()
        return `data:image/${extension === 'svg' ? 'svg+xml' : extension === 'jpg' ? 'jpeg' : extension};base64,${Buffer.from(file[1]).toString('base64')}`
      },
    },
    methods: {
      create: (_value, context) =>
        context.document.create(`untitled.${spec.extensions[0]}`, ''),
      async run(value, context) {
        const data = input(value)
        current(data, context)
        const result = {
          ...(await execute(data, context, true)),
          executed: true,
        }
        cached = { key: key(data), result }
        return result
      },
      async export(value, context) {
        const data = input(value)
        const document = current(data, context)
        let bytes: Uint8Array
        if (data.kind === 'pdf') {
          const result = cached?.key === key(data) ? cached.result : undefined
          if (!result?.pdf)
            throw new Error(
              'Compile this version of the document before exporting its PDF.',
            )
          bytes = result.pdf
        } else if (
          data.kind === 'html' &&
          typeof data.html === 'string' &&
          Buffer.byteLength(data.html) <= 20 * 1024 * 1024
        )
          bytes = Buffer.from(data.html)
        else throw new Error('Invalid export format.')
        return context.exportFile(
          bytes,
          `${document.name.replace(/\.[^.]+$/, '')}.${data.kind}`,
          data.kind,
        )
      },
    },
  }
}
