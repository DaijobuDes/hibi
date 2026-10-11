import { detectLangs } from '../dictionary/lookup.ts'
import { LANGS, type Lang } from '../dictionary/providers.ts'
import { readPreferences as readDictionaryPreferences } from '../dictionary/settings.ts'

export type AutocompletePreferences = {
  suggest: boolean
  tabAccepts: boolean
  learning: boolean
  languages: Lang[]
  excludedDocuments: string[]
  excludedWorkspaces: string[]
}

const key = 'hibi:autocomplete'
const listeners = new Set<() => void>()
let cached: AutocompletePreferences | undefined

function saved(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const ids = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter(
          (id): id is string => typeof id === 'string' && id.length <= 256,
        )
        .slice(0, 512)
    : []

export function readPreferences(): AutocompletePreferences {
  if (cached) return cached
  const previous = saved('hibi:dictionary:typing')
  const value = { ...previous, ...saved(key) }
  cached = {
    suggest: value.suggest !== false,
    tabAccepts: value.tabAccepts !== false,
    learning: value.learning !== false,
    languages: Array.isArray(value.languages)
      ? [
          ...new Set(
            value.languages.filter((lang): lang is Lang =>
              LANGS.includes(lang),
            ),
          ),
        ]
      : detectLangs('word', readDictionaryPreferences()),
    excludedDocuments: ids(value.excludedDocuments),
    excludedWorkspaces: ids(value.excludedWorkspaces),
  }
  return cached
}

export function writePreferences(next: AutocompletePreferences) {
  localStorage.setItem(key, JSON.stringify(next))
  cached = next
  for (const listener of listeners) listener()
}

function changedInAnotherWindow(event: StorageEvent) {
  if (
    event.storageArea !== localStorage ||
    (event.key !== key && event.key !== null)
  )
    return
  cached = undefined
  for (const listener of listeners) listener()
}

export function onPreferencesChange(listener: () => void) {
  if (!listeners.size) {
    cached = undefined
    if (typeof window !== 'undefined')
      window.addEventListener('storage', changedInAnotherWindow)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof window !== 'undefined')
      window.removeEventListener('storage', changedInAnotherWindow)
  }
}
