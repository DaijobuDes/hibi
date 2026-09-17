import { FileDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../ui/Controls'
import { DocumentNotice } from '../../ui/DocumentNotice'
import { PreviewActions } from '../../ui/PreviewActions'
import type { AddonContext } from '../api'
import { svgSource } from './syntax'
import type { TypstResult } from './types'

export function TypstPreview({
  value,
  documentId,
  context,
  block = false,
  toolbar,
  onExport,
}: {
  value: string
  documentId?: string | undefined
  context: AddonContext
  block?: boolean
  toolbar?: HTMLElement | null | undefined
  onExport?: () => Promise<void>
}) {
  const [result, setResult] = useState<TypstResult | null>(null)
  const [busy, setBusy] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const image = useMemo(
    () => (result?.svg ? svgSource(result.svg) : undefined),
    [result?.svg],
  )
  const [projectRevision, setProjectRevision] = useState(0)
  useEffect(
    () =>
      window.hibi.onWorkspaceChanged(() =>
        setProjectRevision((value) => value + 1),
      ),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace changes invalidate imported files even when the source string is unchanged.
  useEffect(() => {
    let active = true
    setBusy(true)
    const timer = setTimeout(() => {
      void context.native
        .query<TypstResult>('compile', { source: value, documentId, block })
        .then((result) => {
          if (active) setResult(result)
        })
        .catch((error: unknown) => {
          if (active)
            setResult({
              diagnostics: [
                {
                  severity: 'error',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Typst compilation failed.',
                },
              ],
            })
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [value, documentId, context, block, projectRevision])
  return (
    <div
      className="typst-preview"
      data-block={block || undefined}
      aria-busy={busy}
    >
      {onExport && (
        <PreviewActions target={toolbar}>
          <Button
            disabled={busy || exporting || !image}
            onClick={async () => {
              setExporting(true)
              setExportError('')
              try {
                await onExport()
              } catch (error) {
                setExportError(
                  error instanceof Error ? error.message : String(error),
                )
              } finally {
                setExporting(false)
              }
            }}
          >
            <FileDown size={14} aria-hidden />
            Export PDF
          </Button>
        </PreviewActions>
      )}
      {exportError && (
        <DocumentNotice title="Export unavailable" message={exportError} />
      )}
      {busy && (
        <p className="typst-progress" role="status">
          Compiling Typst…
        </p>
      )}
      {image && (
        <figure>
          <img
            src={image}
            alt={
              block
                ? 'typst block preview'
                : `typst document preview, ${result?.pages ?? 1} ${(result?.pages ?? 1) === 1 ? 'page' : 'pages'}`
            }
          />
        </figure>
      )}
      {!!result?.diagnostics.length && (
        <DocumentNotice
          title={result.svg ? 'Compilation notes' : 'Preview unavailable'}
          message={result.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join('\n')}
        />
      )}
    </div>
  )
}
