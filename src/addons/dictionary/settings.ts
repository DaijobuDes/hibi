import type { LanguagePreferences } from './lookup'
import type { Lang } from './providers'

export const languageNames: Record<Lang, string> = {
  en: 'English',
  zh: 'Chinese (Mandarin)',
  yue: 'Cantonese',
  ja: 'Japanese',
  tl: 'Filipino',
  fr: 'French',
}

const key = 'hibi:dictionary'

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
