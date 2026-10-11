import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import { Button, TextArea, TextInput } from '../ui'
import type { QuickNoteSettings } from './settings'
import './quick-note.css'

const draftKey = 'hibi:quick-note-draft'
const savedDelay = 900
const mac = navigator.userAgent.includes('Mac')

function readDraft(): { title?: string; markdown?: string } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey) ?? '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function CaptureWindow({
  settings,
  destination,
  save,
}: {
  settings: QuickNoteSettings
  destination: { path: string } | { error: string } | null
  save: (title: string, markdown: string) => Promise<string>
}) {
  const [title, setTitle] = useState(
    () => readDraft().title ?? settings.defaultTitle,
  )
  const [markdown, setMarkdown] = useState(() => readDraft().markdown ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const busy = saving || !!saved
  const submitRef = useRef<() => void>(() => {})
  // Closing keeps the text for next time; only saving clears it.
  useEffect(() => {
    if (saved) return
    if (markdown || title !== settings.defaultTitle)
      localStorage.setItem(draftKey, JSON.stringify({ title, markdown }))
    else localStorage.removeItem(draftKey)
  }, [title, markdown, saved, settings.defaultTitle])
  async function submit() {
    if (busy || !destination || 'error' in destination) return
    setSaving(true)
    setError('')
    try {
      const name = await save(title, markdown)
      localStorage.removeItem(draftKey)
      setSaved(name)
      setTimeout(() => window.close(), savedDelay)
    } catch (failure) {
      setError(errorMessage(failure) || 'Could not save this note.')
    } finally {
      setSaving(false)
    }
  }
  submitRef.current = () => void submit()
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const command = mac ? event.metaKey : event.ctrlKey
      if (
        event.key === 'Escape' ||
        (command && event.key.toLowerCase() === 'w')
      ) {
        event.preventDefault()
        window.close()
      } else if (command && event.key === 'Enter') {
        event.preventDefault()
        submitRef.current()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  const unavailable = !destination || 'error' in destination
  return (
    <main className="quick-note-window" aria-labelledby="quick-note-heading">
      <header>
        <h1 id="quick-note-heading">Quick note</h1>
        {destination && 'path' in destination && (
          <p id="quick-note-destination">
            {`Save to ${destination.path}${settings.folder ? ` / ${settings.folder}` : ''}`}
          </p>
        )}
      </header>
      {destination && 'error' in destination && (
        <p role="alert">{destination.error}</p>
      )}
      <div className="quick-note-form">
        {settings.promptForTitle && (
          <label htmlFor="quick-note-title">
            Title
            <TextInput
              id="quick-note-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              readOnly={busy}
            />
          </label>
        )}
        <label htmlFor="quick-note-body">
          Note
          <TextArea
            id="quick-note-body"
            autoFocus={!settings.promptForTitle}
            aria-describedby="quick-note-hint"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            readOnly={busy}
          />
        </label>
        <p id="quick-note-hint" className="quick-note-hint">
          {mac
            ? 'Press ⌘↩ to save. Escape closes and keeps your text for next time.'
            : 'Press Ctrl+Enter to save. Escape closes and keeps your text for next time.'}
        </p>
        {error && <p role="alert">{error}</p>}
        <p role="status" className="quick-note-status">
          {saved && `Saved ${saved}.`}
        </p>
        <div className="quick-note-actions">
          <Button onClick={() => window.close()} disabled={busy}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || unavailable}
          >
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>
    </main>
  )
}
