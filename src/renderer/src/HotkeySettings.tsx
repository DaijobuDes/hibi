import { Check, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AppCommand,
  actions,
  defaultHotkeys,
  type Hotkeys,
  shortcutError,
  shortcutFromEvent,
} from '../../shared/hotkeys'
import { IconButton } from '../../ui/Controls'
import { SettingsFilter } from '../../ui/SettingsFilter'
import { ShortcutKeys } from '../../ui/ShortcutKeys'

export function HotkeySettings({
  active,
  hotkeys,
  onChange,
  platform,
}: {
  active: boolean
  hotkeys: Hotkeys
  onChange: (hotkeys: Hotkeys) => void
  platform: string
}) {
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<AppCommand | null>(null)
  const [candidate, setCandidate] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const recorder = useRef<HTMLButtonElement>(null)
  const defaults = defaultHotkeys(platform)

  const cancel = useCallback(() => {
    setRecording(null)
    setError('')
  }, [])
  useEffect(() => {
    if (!active) cancel()
  }, [active, cancel])

  useEffect(() => {
    if (!recording) return
    recorder.current?.focus()
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      void window.hibi.setHotkeyRecording(false)
    }
  }, [recording, cancel])

  async function save(next: Hotkeys) {
    setSaving(true)
    setError('')
    try {
      onChange(await window.hibi.saveHotkeys(next))
      setRecording(null)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'could not save hotkeys.',
      )
    } finally {
      setSaving(false)
    }
  }

  const conflict = actions.find(
    ({ id }) => id !== recording && candidate && hotkeys[id] === candidate,
  )
  const invalid =
    shortcutError(candidate, platform) ??
    (conflict ? `already used by ${conflict.label}.` : '')

  return (
    <>
      <h1>hotkeys</h1>
      <p className="settings-description">
        choose a shortcut to rebind it. changes save on this device.
      </p>
      <SettingsFilter
        id="hotkey-filter"
        label="filter hotkeys"
        placeholder="filter commands…"
        value={query}
        onChange={setQuery}
        disabled={!!recording || saving}
        resetDisabled={actions.every(({ id }) => hotkeys[id] === defaults[id])}
        onReset={() => void save(defaults)}
      />
      <div className="settings-group hotkey-list">
        {actions
          .filter(({ label, category }) =>
            `${category} ${label}`.includes(query.toLowerCase().trim()),
          )
          .map(({ id, label, category }) => (
            <div
              className="hotkey-row"
              key={id}
              data-recording={recording === id}
            >
              <div className="hotkey-name">
                <span>{label}</span>
                <small>{category}</small>
              </div>
              <div className="hotkey-binding">
                <button
                  type="button"
                  className="hotkey-recorder"
                  id={`hotkey-${id}`}
                  ref={recording === id ? recorder : undefined}
                  aria-label={`rebind ${label}`}
                  aria-pressed={recording === id}
                  disabled={saving || (!!recording && recording !== id)}
                  onClick={async () => {
                    if (recording) return
                    setError('')
                    try {
                      await window.hibi.setHotkeyRecording(true)
                      setCandidate('')
                      setRecording(id)
                    } catch {
                      setError('could not start shortcut recording.')
                    }
                  }}
                  onKeyDown={(event) => {
                    if (recording !== id) return
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.key === 'Escape') {
                      cancel()
                      return
                    }
                    if (event.key === 'Tab') {
                      cancel()
                      return
                    }
                    if (
                      event.key === 'Enter' &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.altKey &&
                      !event.shiftKey
                    ) {
                      if (candidate && !invalid)
                        void save({ ...hotkeys, [id]: candidate })
                      return
                    }
                    if (event.repeat || event.nativeEvent.isComposing) return
                    const shortcut = shortcutFromEvent(event)
                    if (shortcut) setCandidate(shortcut)
                  }}
                >
                  {recording === id ? (
                    candidate ? (
                      <ShortcutKeys shortcut={candidate} platform={platform} />
                    ) : (
                      <span>press shortcut…</span>
                    )
                  ) : hotkeys[id] ? (
                    <ShortcutKeys shortcut={hotkeys[id]} platform={platform} />
                  ) : (
                    <span>unassigned</span>
                  )}
                </button>
                {recording === id ? (
                  <>
                    <IconButton
                      type="button"
                      aria-label={`save shortcut for ${label}`}
                      title="save shortcut (enter)"
                      disabled={saving || !candidate || !!invalid}
                      onClick={() => void save({ ...hotkeys, [id]: candidate })}
                    >
                      <Check size={15} />
                    </IconButton>
                    <IconButton
                      type="button"
                      aria-label="cancel rebinding"
                      title="cancel (escape)"
                      disabled={saving}
                      onClick={cancel}
                    >
                      <X size={15} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      type="button"
                      aria-label={`reset shortcut for ${label}`}
                      title="reset shortcut"
                      disabled={
                        saving || !!recording || hotkeys[id] === defaults[id]
                      }
                      onClick={() =>
                        void save({ ...hotkeys, [id]: defaults[id] })
                      }
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                    <IconButton
                      type="button"
                      aria-label={`clear shortcut for ${label}`}
                      title="clear shortcut"
                      disabled={saving || !!recording || !hotkeys[id]}
                      onClick={() => void save({ ...hotkeys, [id]: '' })}
                    >
                      <X size={14} />
                    </IconButton>
                  </>
                )}
              </div>
              {recording === id && (
                <p className="hotkey-feedback" role="status">
                  {invalid || 'enter to save · escape to cancel'}
                </p>
              )}
            </div>
          ))}
      </div>
      {error && (
        <p className="hotkey-feedback" role="alert">
          {error}
        </p>
      )}
      <p className="settings-description hotkey-note">
        standard editing and window shortcuts stay reserved.
      </p>
    </>
  )
}
