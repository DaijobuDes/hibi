import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DocumentState } from '../../shared/desktop'

export const autosaveDelays = [1000, 2000, 5000, 10000, 30000] as const
type Preferences = { enabled: boolean; delay: number }
const key = 'hibi:autosave'
let preferences: Preferences = { enabled: false, delay: 2000 }
try {
  const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
  preferences = {
    enabled: stored.enabled === true,
    delay: autosaveDelays.includes(stored.delay) ? stored.delay : 2000,
  }
} catch {
  /* Use defaults if preferences are unavailable. */
}
const listeners = new Set<() => void>()
export const autosave = {
  snapshot: () => preferences,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  set(next: Partial<Preferences>) {
    preferences = {
      enabled: next.enabled ?? preferences.enabled,
      delay:
        autosaveDelays.find((delay) => delay === next.delay) ??
        preferences.delay,
    }
    localStorage.setItem(key, JSON.stringify(preferences))
    for (const listener of listeners) listener()
  },
}

export function useAutosave(
  document: DocumentState | null,
  busy: boolean,
  onSaved: (document: DocumentState) => void,
) {
  const settings = useSyncExternalStore(autosave.subscribe, autosave.snapshot)
  const [result, setResult] = useState<{
    id: string
    revision: number
    status: 'saving' | 'saved' | 'waiting' | 'conflict' | 'error'
    error?: string
  } | null>(null)
  const currentResult =
    result?.id === document?.id && result?.revision === document?.revision
      ? result
      : null
  const inFlight = useRef(false)
  // A manual save, another document, or toggling autosave clears a paused attempt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these events reset the current autosave status.
  useEffect(
    () => setResult(null),
    [
      document?.id,
      document?.revision,
      document?.savedMarkdown,
      settings.enabled,
    ],
  )
  useEffect(() => {
    if (
      !settings.enabled ||
      !document?.dirty ||
      !document.canAutosave ||
      busy ||
      inFlight.current ||
      currentResult?.status === 'conflict' ||
      currentResult?.status === 'error'
    )
      return
    const timer = setTimeout(async () => {
      inFlight.current = true
      const identity = { id: document.id, revision: document.revision }
      setResult({ ...identity, status: 'saving' })
      try {
        const saved = await window.hibi.autosaveDocument(document.revision)
        if (saved.document) onSaved(saved.document)
        // Results still acknowledge the saved baseline if typing continues during I/O.
        setResult({
          ...identity,
          status: saved.status === 'skipped' ? 'waiting' : saved.status,
        })
      } catch (error) {
        setResult({
          ...identity,
          status: 'error',
          error:
            error instanceof Error ? error.message : 'could not save the file.',
        })
      } finally {
        inFlight.current = false
      }
    }, settings.delay)
    return () => clearTimeout(timer)
  }, [document, busy, settings, currentResult, onSaved])
  const label = !settings.enabled
    ? 'Autosave off'
    : !document?.canAutosave
      ? 'Autosave · save first'
      : currentResult?.status === 'saving'
        ? 'Autosave · saving'
        : currentResult?.status === 'conflict' ||
            currentResult?.status === 'error'
          ? 'Autosave · paused'
          : document.dirty
            ? 'Autosave · waiting'
            : 'Autosave · saved'
  const tooltip =
    currentResult?.status === 'conflict'
      ? 'File changed outside Hibi. save manually to review the changes before autosave resumes.'
      : (currentResult?.error ??
        (!settings.enabled
          ? 'Autosave is off · click to configure'
          : !document?.canAutosave
            ? 'Save this draft once to choose its location.'
            : `Save after ${settings.delay / 1000} seconds without typing · click to configure`))
  return { label, tooltip }
}
