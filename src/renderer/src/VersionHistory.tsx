import { useEffect, useState } from 'react'
import type { DocumentVersion } from '../../shared/history'
import { Button } from '../../ui/Controls'
import './version-history.css'

export function VersionHistory({
  close,
}: {
  close: (id: string | null) => void
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void window.hibi
      .listVersions()
      .then((versions) => {
        if (!active) return
        setVersions(versions)
        setSelected(versions[0]?.id ?? null)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (active) {
          setError(String(error))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!selected) return
    let active = true
    setPreview(null)
    setError('')
    void window.hibi
      .previewVersion(selected)
      .then((text) => {
        if (active) setPreview(text)
      })
      .catch((error: unknown) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [selected])
  return (
    <>
      {loading ? (
        <p role="status">Loading versions…</p>
      ) : !versions.length ? (
        <p>Save this file to start its local history.</p>
      ) : (
        <div className="version-history">
          <nav aria-label="Saved versions">
            {versions.map((version, index) => (
              <Button
                key={version.id}
                aria-pressed={version.id === selected}
                onClick={() => setSelected(version.id)}
              >
                <span>{new Date(version.savedAt).toLocaleString()}</span>
                <small>
                  {index === 0 ? 'Latest · ' : ''}
                  {version.bytes.toLocaleString()} bytes
                </small>
              </Button>
            ))}
          </nav>
          <section aria-label="Version preview">
            <pre>{preview ?? 'Loading preview…'}</pre>
          </section>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button onClick={() => close(null)}>Cancel</Button>
        <Button
          className="dialog-primary"
          onClick={() => close(selected)}
          disabled={!selected || preview === null || !!error}
        >
          Restore to editor
        </Button>
      </div>
    </>
  )
}
