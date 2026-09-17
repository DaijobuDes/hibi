import { StreamLanguage } from '@codemirror/language'
import { r } from '@codemirror/legacy-modes/mode/r'
import DOMPurify from 'dompurify'
import { FileDown, Play } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import { Button, SettingRow } from '../../ui/Controls'
import { DocumentNotice } from '../../ui/DocumentNotice'
import { PreviewActions } from '../../ui/PreviewActions'
import {
  type AddonContext,
  type AddonManifest,
  type DocumentPreviewProps,
  defineAddon,
  type RenderedMarkdown,
} from '../api'
import { formatLanguage } from './format-language'
import { type FormatResult, type FormatSpec, formatSpec } from './format-specs'
import css from './format-style.css?inline'
import { formatToolbar } from './format-toolbar'

const FormatPdf = lazy(() =>
  import('./FormatPdf').then((module) => ({ default: module.FormatPdf })),
)
const features = [
  { id: 'headings', label: 'Headings', selector: 'h1,h2,h3,h4,h5,h6' },
  { id: 'emphasis', label: 'Emphasis', selector: 'em,strong,b,i' },
  { id: 'links', label: 'Links', selector: 'a' },
  { id: 'images', label: 'Images', selector: 'img' },
]

async function htmlResult(
  context: AddonContext,
  result: FormatResult,
  id?: string,
): Promise<RenderedMarkdown> {
  const html = result.pdf
    ? await (await import('./FormatPdf')).pdfHtml(result.pdf)
    : (result.html ?? '')
  const parsed = new DOMParser().parseFromString(
    DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
      FORBID_ATTR: ['style', 'srcset'],
    }),
    'text/html',
  )
  for (const feature of features)
    if (!context.editor.isSyntaxEnabled(feature.id)) {
      for (const element of parsed.querySelectorAll(feature.selector))
        element.replaceWith(
          parsed.createTextNode(
            element.getAttribute('alt') ?? element.textContent ?? '',
          ),
        )
    }
  for (const code of parsed.querySelectorAll('pre code')) {
    const classes = [
      ...code.classList,
      ...(code.parentElement?.classList ?? []),
    ]
    const language = classes
      .map((value) => value.replace(/^(?:language|lang)-/, ''))
      .find((value) => context.editor.resolveCodeLanguage(value))
    if (language)
      code.innerHTML = context.editor.renderCode(
        code.textContent ?? '',
        language,
      )
  }
  let embedded = html.length
  if (id)
    for (const image of parsed.querySelectorAll<HTMLImageElement>('img[src]')) {
      const source = image.getAttribute('src') ?? ''
      if (!/^(?:data:|[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) {
        const url = await context.native
          .query<string | null>('image', { source, documentId: id })
          .catch(() => null)
        if (url) {
          embedded += url.length
          if (embedded > 20 * 1024 * 1024)
            throw new Error('Embedded images exceed the 20 MiB preview limit.')
          image.src = url
        } else image.removeAttribute('src')
      }
    }
  return { html: parsed.body.innerHTML, css }
}

function HtmlPreview({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    // Rendered content is sanitized before crossing this one HTML insertion boundary.
    host.current.innerHTML = html
  }, [html])
  return <div ref={host} className="format-content" />
}

export function startFormat(context: AddonContext, spec: FormatSpec) {
  const language = formatLanguage(spec, context.editor.resolveCodeLanguage)
  const formatting = formatToolbar(spec.reader)
  if (spec.engine === 'rmarkdown' || spec.engine === 'quarto')
    context.editor.registerCodeLanguage({
      id: 'r',
      language: StreamLanguage.define(r),
    })
  context.styles.register('document-preview', css)
  context.editor.registerCodeLanguage({
    id: spec.reader === 'markdown' ? spec.id : spec.reader,
    aliases: spec.extensions,
    language,
  })
  context.editor.registerDocumentSyntax({
    id: 'preview',
    label: `${spec.name} preview`,
    group: spec.name,
    level: 'block',
    description: 'Render this document format without changing its source.',
  })
  if (spec.engine !== 'latex')
    for (const feature of features)
      context.editor.registerDocumentSyntax({
        id: feature.id,
        label: feature.label,
        group: spec.name,
        level: 'block',
        description: `Render ${feature.label.toLowerCase()} in ${spec.name} previews and HTML exports.`,
      })
  async function render(source: string, documentId?: string) {
    if (!context.editor.isSyntaxEnabled('preview'))
      return {
        html: `<pre>${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`,
        css,
      }
    return htmlResult(
      context,
      await context.native.query<FormatResult>('render', {
        source,
        documentId,
        export: true,
      }),
      documentId,
    )
  }
  async function run(document: DocumentPreviewProps['document']) {
    if (
      !(await context.dialogs.confirm({
        title: `${spec.engine === 'latex' ? 'Compile' : 'Run'} ${document.name}?`,
        description:
          'This runs the document and its project code with access to your files and network. Run only content you trust. Changes require another run.',
        confirmLabel:
          spec.engine === 'latex' ? 'Compile document' : 'Run document',
      }))
    )
      return null
    return context.native.invoke<FormatResult>('run', {
      source: document.markdown,
      documentId: document.id,
    })
  }
  function Preview({ value, document, toolbar }: DocumentPreviewProps) {
    const [result, setResult] = useState<FormatResult | null>(null)
    const [html, setHtml] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [running, setRunning] = useState(false)
    const [version, setVersion] = useState(0)
    const previewDocument = useRef(document.id)
    const latest = useRef({ value, id: document.id })
    latest.current = { value, id: document.id }
    useEffect(() => {
      const changed = () => setVersion((value) => value + 1)
      const syntax = context.editor.onSyntaxChange(changed)
      const highlighting = context.editor.onCodeHighlightingChange(changed)
      return () => {
        syntax()
        highlighting()
      }
    }, [])
    // biome-ignore lint/correctness/useExhaustiveDependencies: syntax preference changes invalidate rendering.
    useEffect(() => {
      let active = true
      if (
        previewDocument.current !== document.id ||
        !context.editor.isSyntaxEnabled('preview')
      ) {
        setResult(null)
        setHtml('')
      }
      previewDocument.current = document.id
      setError('')
      setBusy(true)
      const timer = setTimeout(() => {
        void (async () => {
          if (!context.editor.isSyntaxEnabled('preview')) {
            if (active) setBusy(false)
            return
          }
          const next = await context.native.query<FormatResult>('render', {
            source: value,
            documentId: document.id,
          })
          const rendered = next.pdf
            ? null
            : await htmlResult(context, next, document.id)
          if (active) {
            setResult(next)
            setHtml(rendered?.html ?? '')
          }
        })()
          .catch((error) => {
            if (active) {
              setResult(null)
              setHtml('')
              setError(errorMessage(error))
            }
          })
          .finally(() => {
            if (active) setBusy(false)
          })
      }, 250)
      return () => {
        active = false
        clearTimeout(timer)
      }
    }, [value, document.id, version])
    const enabled = context.editor.isSyntaxEnabled('preview')
    const exportResult = async () => {
      try {
        const rendered = result?.pdf
          ? null
          : await htmlResult(context, result ?? {}, document.id)
        const path = await context.native.invoke<string | null>('export', {
          source: value,
          documentId: document.id,
          kind: result?.pdf ? 'pdf' : 'html',
          html: rendered
            ? `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="format-content">${rendered.html}</body></html>`
            : undefined,
        })
        if (path) context.notify(`Exported to ${path}`)
      } catch (error) {
        setError(errorMessage(error))
      }
    }
    return (
      <div className="format-preview" aria-busy={busy || running}>
        <PreviewActions target={toolbar}>
          {spec.engine && (
            <Button
              disabled={running || busy || !enabled}
              onClick={async () => {
                const current = () =>
                  latest.current.value === value &&
                  latest.current.id === document.id
                setRunning(true)
                setError('')
                try {
                  const next = await run(document)
                  if (next && current()) {
                    const rendered = next.pdf
                      ? null
                      : await htmlResult(context, next, document.id)
                    if (current()) {
                      setResult(next)
                      setHtml(rendered?.html ?? '')
                    }
                  }
                } catch (error) {
                  if (current()) setError(errorMessage(error))
                } finally {
                  setRunning(false)
                }
              }}
            >
              <Play size={14} aria-hidden />
              {spec.engine === 'latex' ? 'Compile document' : 'Run document'}
            </Button>
          )}
          <Button
            disabled={!result || busy || running || !enabled}
            onClick={() => void exportResult()}
          >
            <FileDown size={14} aria-hidden />
            Export {result?.pdf ? 'PDF' : 'HTML'}
          </Button>
        </PreviewActions>
        {!enabled && (
          <DocumentNotice
            title="Preview disabled"
            message="Enable this format’s preview in Settings → Syntax."
          />
        )}
        {enabled && spec.engine && !result?.executed && !result?.pdf && (
          <p className="format-message">
            {spec.engine === 'latex'
              ? 'Compile for typeset PDF output.'
              : 'Embedded code stays inert until you run this document.'}
          </p>
        )}
        {(running || (busy && !result && !html)) && (
          <DocumentNotice
            title={running ? 'Running document…' : 'Rendering preview…'}
            busy
          />
        )}
        {error && (
          <DocumentNotice title="Preview unavailable" message={error} />
        )}
        {enabled && result?.pdf ? (
          <Suspense fallback={<DocumentNotice title="Loading PDF…" busy />}>
            <FormatPdf data={result.pdf} />
          </Suspense>
        ) : enabled && html ? (
          <HtmlPreview html={html} />
        ) : null}
      </div>
    )
  }
  context.editor.registerDocumentFormat({
    id: spec.reader,
    name: spec.name,
    extensions: spec.extensions,
    views: ['side-by-side', 'markdown'],
    formatting,
    ...(formatting !== 'markdown'
      ? {
          insertMedia: (
            items: readonly import('../../shared/media').MediaAttachment[],
          ) =>
            items
              .map(
                ({ url, alt }) =>
                  formatting.apply(
                    /\.(mp4|webm|ogv|mov)$/i.test(url) ? 'link' : 'image',
                    { source: '', from: 0, to: 0, values: { url, alt } },
                  )?.insert ?? '',
              )
              .join('\n\n'),
        }
      : {}),
    language,
    codeLanguage: spec.reader === 'markdown' ? spec.id : spec.reader,
    Preview,
    render,
  })
  context.commands.register({
    id: 'new-document',
    label: `New ${spec.name} document`,
    run: async () => {
      if (await context.native.invoke('create'))
        context.app.runAction('side-by-side')
    },
  })
}

export function FormatSettings({ spec }: { spec: FormatSpec }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <>
      <h2>Native tools</h2>
      <div className="settings-group">
        <SettingRow
          id={`tools-${spec.id}`}
          label="Renderer availability"
          description={
            spec.engine
              ? 'Typing uses a restricted preview. Run uses the native compiler or runtime.'
              : 'Rendering runs in a background process.'
          }
        >
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const result = (await window.hibi.queryAddon(
                  spec.id,
                  'tools',
                )) as FormatResult
                setStatus(result.diagnostics ?? 'Ready')
              } catch (error) {
                setStatus(errorMessage(error))
              } finally {
                setBusy(false)
              }
            }}
          >
            Check tools
          </Button>
        </SettingRow>
      </div>
      {status && <DocumentNotice title="Native tools" message={status} />}
    </>
  )
}

export function formatAddon(manifest: AddonManifest) {
  const spec = formatSpec(manifest)
  return defineAddon({
    manifest,
    Settings: () => <FormatSettings spec={spec} />,
    start: (context) => startFormat(context, spec),
  })
}
