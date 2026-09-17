import { useEffect, useState } from 'react'
import type { RecentWorkspace } from '../../shared/workspace'
import { Button } from '../../ui/Controls'
import type { ViewMode } from './Editor'
import './startup-placeholder.css'

export function StartupPlaceholder({
  mode,
  busy,
  onOpen,
  onDismiss,
}: {
  mode: ViewMode
  busy: boolean
  onOpen: (id: string) => void
  onDismiss: () => void
}) {
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  useEffect(() => {
    let active = true
    void window.hibi
      .getRecentWorkspaces()
      .then((items) => {
        if (active) setRecent(items)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return (
    <section
      className="startup-placeholder"
      data-mode={mode}
      aria-label="start writing"
    >
      <h2>start typing</h2>
      <h4>recent workspaces</h4>
      {recent.length ? (
        <ol>
          {recent.map(({ id, path }) => (
            <li key={id}>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onOpen(id)}
              >
                {path}
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p>no recent workspaces yet.</p>
      )}
      <Button variant="ghost" disabled={busy} onClick={onDismiss}>
        dismiss this
      </Button>
    </section>
  )
}
