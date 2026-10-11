import type { LanguagePreferences } from './lookup'
import { LANGS, type Lang } from './providers.ts'

// `label` fields are collected into the UI copy catalog.
const languages: Record<Lang, { label: string }> = {
  en: { label: 'English' },
  zh: { label: 'Chinese (Mandarin)' },
  yue: { label: 'Cantonese' },
  ja: { label: 'Japanese' },
  tl: { label: 'Filipino' },
  fr: { label: 'French' },
}
export const languageNames = Object.fromEntries(
  LANGS.map((lang) => [lang, languages[lang].label]),
) as Record<Lang, string>

const key = 'hibi:dictionary'
const recentKey = 'hibi:dictionary:recent-pack'

export function readRecentPack(): Lang | undefined {
  try {
    const id = localStorage.getItem(recentKey)
    return LANGS.find((lang) => lang === id)
  } catch {
    return undefined
  }
}

export function writeRecentPack(id: Lang) {
  try {
    localStorage.setItem(recentKey, id)
  } catch {
    // Storage availability does not affect dictionary results.
  }
}

export function readPreferences(): LanguagePreferences {
  let saved: Partial<Record<keyof LanguagePreferences, unknown>> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      saved = parsed
  } catch {
    // Invalid local preferences use defaults.
  }
  return {
    han: saved.han === 'yue' || saved.han === 'ja' ? saved.han : 'zh',
    latin: saved.latin === 'tl' || saved.latin === 'fr' ? saved.latin : 'en',
  }
}

export function writePreferences(preferences: LanguagePreferences) {
  localStorage.setItem(key, JSON.stringify(preferences))
}
