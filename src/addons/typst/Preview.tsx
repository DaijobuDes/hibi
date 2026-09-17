import { useEffect, useMemo, useState } from 'react'
import type { AddonContext } from '../api'
import { svgSource } from './syntax'
import type { TypstResult } from './types'

export function TypstPreview({
  value,
  documentId,
  context,
  block = false,
}: {
  value: string
  documentId?: string | undefined
  context: AddonContext
  block?: boolean
}) {
  const [result, setResult] = useState<TypstResult | null>(null)
  const [busy, setBusy] = useState(true)
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
                      : 'typst compilation failed.',
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
      {busy && (
        <p className="typst-progress" role="status">
          compiling typst…
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
        <div
          className="typst-diagnostics"
          role="status"
          data-error={result.diagnostics.some(
            (diagnostic) => diagnostic.severity === 'error',
          )}
        >
          {result.diagnostics.map((diagnostic, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated diagnostics have no interactive state but need distinct keys.
            <p key={`${index}-${diagnostic.message}`}>{diagnostic.message}</p>
          ))}
        </div>
      )}
    </div>
  )
}
