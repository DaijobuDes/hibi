import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import type { AddonWindowProps } from '../api'
import { Button, ShortcutKeys } from '../ui'
import { type QuickNoteSettings, readSettings, settingsKey } from './settings'
import './quick-note.css'

const draftKey = 'hibi:quick-note-draft'
const savedDelay = 700
const mac = navigator.userAgent.includes('Mac')
const platform = mac ? 'darwin' : 'win32'
type Destination = { id: string; path: string } | { error: string }

function readDraft() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey) ?? '{}')
    return value && typeof value === 'object' && 'markdown' in value
      ? String(value.markdown)
      : null
  } catch {
    return null
  }
}

/** A new note starts with the default title as its heading when Hibi asks for a title. */
const template = (settings: QuickNoteSettings) =>
  settings.promptForTitle ? `# ${settings.defaultTitle}\n\n` : ''

/** File name from the note's first heading, or the default title. */
export function noteTitle(markdown: string, fallback: string) {
  const first =
    markdown
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  const heading = /^#{1,6}\s+(.+)$/.exec(first)?.[1] ?? ''
  const title = heading
    .replace(/[\\/:*?"<>|#\p{Cc}]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
  return title || fallback
}

export function CaptureWindow({ Editor, native, close }: AddonWindowProps) {
  const [settings, setSettings] = useState(readSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [destination, setDestination] = useState<Destination | null>(null)
  const [session, setSession] = useState(0)
  const [initial] = useState(() => readDraft() ?? template(settings))
  const markdown = useRef(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const busy = saving || !!saved
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== settingsKey) return
      const next = readSettings()
      // An untouched note follows the new settings; a started one is kept.
      if (markdown.current === template(settingsRef.current)) {
        markdown.current = template(next)
        setSession((value) => value + 1)
      }
      setSettings(next)
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
  async function submit() {
    if (busy || !destination || 'error' in destination) return
    setSaving(true)
    setError('')
    try {
      const result = await native.invoke<{ name: string }>('save', {
        workspaceId: destination.id,
        folder: settings.folder,
        title: noteTitle(markdown.current, settings.defaultTitle),
        markdown: markdown.current,
      })
      localStorage.removeItem(draftKey)
      setSaved(result.name)
      setTimeout(() => {
        // The window stays alive hidden; start the next note empty.
        markdown.current = template(settings)
        setSaved('')
        setSession((value) => value + 1)
        close()
      }, savedDelay)
    } catch (failure) {
      setError(errorMessage(failure) || 'Could not save this note.')
    } finally {
      setSaving(false)
    }
  }
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    // Editor popups stop Escape themselves, so it only reaches here to close.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      close()
    }
    // Capture so the editor never turns these into a line break first.
    const command = (event: KeyboardEvent) => {
      if (event.isComposing || !(mac ? event.metaKey : event.ctrlKey)) return
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        void submitRef.current()
      }
    }
    window.addEventListener('keydown', dismiss)
    window.addEventListener('keydown', command, true)
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('keydown', command, true)
    }
  }, [close])
  const where =
    destination && 'path' in destination
      ? [
          destination.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
          ...settings.folder.split('/').filter(Boolean),
        ].join(' › ')
      : ''
  return (
    <div className="quick-note-window">
      <Editor
        key={session}
        label="Note"
        defaultValue={session ? markdown.current : initial}
        onChange={(value) => {
          markdown.current = value
          if (value.trim())
            localStorage.setItem(draftKey, JSON.stringify({ markdown: value }))
          else localStorage.removeItem(draftKey)
        }}
      />
      <footer className="dialog-footer quick-note-bar">
        {error || (destination && 'error' in destination) ? (
          <p role="alert" className="quick-note-meta">
            {error ||
              (destination && 'error' in destination && destination.error)}
          </p>
        ) : (
          <p role="status" className="quick-note-meta">
            {saved ? (
              `Saved ${saved}.`
            ) : (
              <span
                data-tooltip={
                  destination && 'path' in destination
                    ? `${destination.path}${settings.folder ? `/${settings.folder}` : ''}`
                    : undefined
                }
                data-verbatim="true"
              >
                {where}
              </span>
            )}
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
          disabled={busy || !destination || 'error' in destination}
          aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
        >
          {saving ? 'Saving…' : 'Save'}
          <span aria-hidden="true">
            <ShortcutKeys
              shortcut={mac ? 'meta+enter' : 'ctrl+enter'}
              platform={platform}
            />
          </span>
        </Button>
      </footer>
    </div>
  )
}
