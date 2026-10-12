import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import type { AddonWindowProps } from '../api'
import { Button, ShortcutKeys, TextArea, TextInput } from '../ui'
import { readSettings, settingsKey } from './settings'
import './quick-note.css'

const draftKey = 'hibi:quick-note-draft'
const savedDelay = 900
const mac = navigator.userAgent.includes('Mac')
const platform = mac ? 'darwin' : 'win32'
const saveKeys = mac ? 'meta+enter' : 'ctrl+enter'
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
  const unavailable = !destination || 'error' in destination
  return (
    <main className="quick-note-window" aria-label="Quick note">
      {settings.promptForTitle && (
        <TextInput
          className="quick-note-title"
          variant="inline"
          aria-label="Title"
          placeholder="Title"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          readOnly={busy}
        />
      )}
      <TextArea
        className="quick-note-body"
        variant="inline"
        aria-label="Note"
        aria-describedby="quick-note-destination"
        autoFocus={!settings.promptForTitle}
        placeholder="Write in Markdown…"
        spellCheck
        value={markdown}
        onChange={(event) => setMarkdown(event.target.value)}
        readOnly={busy}
      />
      <footer className="quick-note-bar">
        {error || (destination && 'error' in destination) ? (
          <p role="alert" className="quick-note-meta">
            {error ||
              (destination && 'error' in destination && destination.error)}
          </p>
        ) : (
          <p
            id="quick-note-destination"
            role="status"
            className="quick-note-meta"
          >
            {saved
              ? `Saved ${saved}.`
              : destination && 'path' in destination
                ? `${destination.path}${settings.folder ? ` / ${settings.folder}` : ''}`
                : ''}
          </p>
        )}
        <Button onClick={close} disabled={busy} aria-keyshortcuts="Escape">
          Cancel
          <span aria-hidden="true">
            <ShortcutKeys shortcut="escape" platform={platform} />
          </span>
        </Button>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || unavailable}
          aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
        >
          {saving ? 'Saving…' : 'Save'}
          <span aria-hidden="true">
            <ShortcutKeys shortcut={saveKeys} platform={platform} />
          </span>
        </Button>
      </footer>
    </main>
  )
}
