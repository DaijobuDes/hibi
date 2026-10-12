import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import type { AddonWindowProps } from '../api'
import { Button, TextArea, TextInput } from '../ui'
import { readSettings, settingsKey } from './settings'
import './quick-note.css'

const draftKey = 'hibi:quick-note-draft'
const savedDelay = 900
const mac = navigator.userAgent.includes('Mac')
type Destination = { id: string; path: string } | { error: string }

function readDraft(): { title?: string; markdown?: string } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey) ?? '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function CaptureWindow({ native, close }: AddonWindowProps) {
  const [settings, setSettings] = useState(readSettings)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [title, setTitle] = useState(
    () => readDraft().title ?? settings.defaultTitle,
  )
  const [markdown, setMarkdown] = useState(() => readDraft().markdown ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const busy = saving || !!saved
  const submitRef = useRef<() => void>(() => {})
  // Settings and the draft share the main window's storage.
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === settingsKey) setSettings(readSettings())
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    let active = true
    native
      .query<{ id: string; path: string }>('destination', settings.workspaceId)
      .then(
        (target) => active && setDestination(target),
        (failure) => active && setDestination({ error: errorMessage(failure) }),
      )
    return () => {
      active = false
    }
  }, [native, settings.workspaceId])
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
      const result = await native.invoke<{ name: string }>('save', {
        workspaceId: destination.id,
        folder: settings.folder,
        title,
        markdown,
      })
      localStorage.removeItem(draftKey)
      setSaved(result.name)
      setTimeout(close, savedDelay)
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
        close()
      } else if (command && event.key === 'Enter') {
        event.preventDefault()
        submitRef.current()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [close])
  return (
    <main className="quick-note-window" aria-label="Quick note">
      {destination && 'path' in destination && (
        <p id="quick-note-destination" className="quick-note-hint">
          {`Save to ${destination.path}${settings.folder ? ` / ${settings.folder}` : ''}`}
        </p>
      )}
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
            className="quick-note-body"
            autoFocus={!settings.promptForTitle}
            aria-describedby="quick-note-destination quick-note-hint"
            placeholder="Write in Markdown…"
            spellCheck
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
          <Button onClick={close} disabled={busy}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !destination || 'error' in destination}
          >
            {saving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>
    </main>
  )
}
