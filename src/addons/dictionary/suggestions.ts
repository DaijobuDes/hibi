import type {
  CompletionItem,
  CompletionProvider,
} from '../../shared/completions.ts'
import type { AddonContext } from '../api.ts'
import { detectLangs, type LanguagePreferences, matchCase } from './lookup.ts'
import type { DictionaryRegistry, Lang } from './providers.ts'
import { languageNames, readPreferences } from './settings.ts'

export type TypingPreferences = { suggest: boolean; tabAccepts: boolean }

const key = 'hibi:dictionary:typing'
const listeners = new Set<() => void>()

export function readTyping(): TypingPreferences {
  let saved: Partial<Record<keyof TypingPreferences, unknown>> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      saved = parsed
  } catch {
    // Invalid local preferences use defaults.
  }
  return {
    suggest: saved.suggest === true,
    tabAccepts: saved.tabAccepts !== false,
  }
}

export function writeTyping(preferences: TypingPreferences) {
  localStorage.setItem(key, JSON.stringify(preferences))
  for (const listener of listeners) listener()
}

export function onTypingChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const MIN_PREFIX = 3
const MAX_ITEMS = 8
/** Packs return headwords in index order, so ask for more than are shown. */
const ASK = 24
// Latin script only: Chinese and Japanese have no spaces to end a prefix.
const partial =
  /(?:^|[^\p{L}\p{M}'’-])(\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*)$/u

// Only quotes, brackets, and emphasis may open a prose word; anything else
// starts a slash command, mention, tag, emoji, escape, entity, path, or url.
const opening = /^(?:[("'“‘*_~]|\[(?!\[))*$/u

/** True inside inline code or a fenced block that opens within `before`. */
function inCode(before: string, line: string) {
  return (
    (line.match(/`+/g)?.length ?? 0) % 2 === 1 ||
    (before.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 === 1
  )
}

/**
 * The Latin-script prose word being typed at the end of `before`, if it is
 * long enough. Commands, code, links, and urls get no word suggestions.
 */
export function prefixAt(before: string, after: string) {
  if (/^[\p{L}\p{M}]/u.test(after)) return null
  const word = partial.exec(before)?.[1]
  if (!word || word.length < MIN_PREFIX || word.length > 64) return null
  const line = before.slice(before.lastIndexOf('\n') + 1)
  const token = /\S*$/u.exec(line)?.[0] ?? ''
  return opening.test(token.slice(0, -word.length)) && !inCode(before, line)
    ? word
    : null
}

/**
 * Orders pack matches for `prefix`: preferred language first, then single
 * words before phrases, lowercase headwords before names unless the prefix is
 * capitalized, and shorter words first. The prefix itself is dropped.
 */
export function rankWords(
  prefix: string,
  found: readonly { lang: Lang; words: readonly string[] }[],
) {
  const typed = prefix.toLowerCase()
  const capital = prefix[0] !== prefix[0]?.toLowerCase()
  const seen = new Set([typed])
  const candidates: { word: string; lang: Lang; order: number }[] = []
  for (const [order, { lang, words }] of found.entries())
    for (const word of words) {
      const lower = word.toLowerCase()
      if (seen.has(lower) || word.length > 64 || /[\r\n]/.test(word)) continue
      seen.add(lower)
      candidates.push({ word, lang, order })
    }
  const score = (word: string) =>
    Number(/\s/.test(word)) * 1000 +
    Number(!capital && word[0] !== word[0]?.toLowerCase()) * 100 +
    word.length
  return candidates
    .sort(
      (left, right) =>
        left.order - right.order ||
        score(left.word) - score(right.word) ||
        left.word.localeCompare(right.word),
    )
    .slice(0, MAX_ITEMS)
}

/** Word completions from installed offline packs only; nothing is sent online. */
export function dictionaryCompletions(
  registry: DictionaryRegistry,
  preferences: () => LanguagePreferences & TypingPreferences,
  languageName: (lang: Lang) => string,
): CompletionProvider {
  return async (request, signal) => {
    const { anchor, head } = request.selection
    if (anchor !== head) return []
    const prefix = prefixAt(request.before, request.after)
    if (!prefix) return []
    const settings = preferences()
    const found: { lang: Lang; words: string[] }[] = []
    for (const lang of detectLangs(prefix, settings)) {
      for (const provider of await registry.providers(lang, 'lookup')) {
        signal.throwIfAborted()
        if (provider.kind !== 'offline' || !provider.complete) continue
        const words = await provider.complete(prefix, lang, signal, ASK)
        if (words.length) found.push({ lang, words })
        break
      }
    }
    signal.throwIfAborted()
    const ranked = rankWords(prefix, found)
    const several = new Set(ranked.map((item) => item.lang)).size > 1
    return ranked.map(
      ({ word, lang }): CompletionItem => ({
        label: word,
        ...(several ? { detail: languageName(lang) } : {}),
        insertText: matchCase(prefix, word),
        from: head - prefix.length,
        to: head,
        ...(settings.tabAccepts ? {} : { acceptOnTab: false }),
      }),
    )
  }
}

/** Keeps the completion provider registered only while suggestions are on. */
export function watchSuggestions(
  context: AddonContext,
  registry: DictionaryRegistry,
) {
  let registered: Promise<(() => void) | undefined> | null = null
  const sync = () => {
    const on = readTyping().suggest
    if (on && !registered)
      registered = context.editor
        .registerCompletionProvider(
          dictionaryCompletions(
            registry,
            () => ({ ...readPreferences(), ...readTyping() }),
            (lang) => languageNames[lang],
          ),
        )
        .catch(() => undefined)
    else if (!on && registered) {
      void registered.then((stop) => stop?.())
      registered = null
    }
  }
  sync()
  return onTypingChange(sync)
}
