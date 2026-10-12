import type {
  CompletionItem,
  CompletionProvider,
} from '../../shared/completions.ts'
import { codeSpans } from '../../shared/prose-context.ts'
import type { AddonContext } from '../api.ts'
import { type CustomWord, listCustomWords, yours } from './custom-words.ts'
import { latinLangs, matchCase } from './lookup.ts'
import { completeAll } from './offline.ts'
import type { Lang } from './providers.ts'
import { languageNames } from './settings.ts'

export type TypingPreferences = {
  suggest: boolean
  tabAccepts: boolean
  /** Languages to suggest from, in the order they were turned on. */
  languages: Lang[]
}

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
  // Stored order is kept; unknown or repeated entries are dropped.
  const languages = Array.isArray(saved.languages)
    ? [...new Set<unknown>(saved.languages)].filter((lang): lang is Lang =>
        latinLangs.includes(lang as Lang),
      )
    : []
  return {
    suggest: saved.suggest === true,
    tabAccepts: saved.tabAccepts !== false,
    languages: languages.length ? languages : ['en'],
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

// A backtick fence's info string has no backticks, so a line starting with
// inline code such as ```a``` is not a fence (CommonMark example 145).
const fence = /^ {0,3}(?:`{3,}[^`\n]*|~{3,}.*)$/gm

/** True inside inline code or a fenced block that opens within `before`. */
function inCode(before: string, line: string) {
  return (
    codeSpans(line).some(({ closed }) => !closed) ||
    (before.match(fence)?.length ?? 0) % 2 === 1
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
 * Orders pack matches for `prefix`, given in the user's language order. Match
 * quality comes first: words that start with the prefix as typed (accents
 * included) before accent-folded matches, single words before phrases, and
 * lowercase headwords before names unless the prefix is capitalized (German
 * capitalizes every noun, so its case is not held against it). Language order
 * comes next, then shorter words; packs carry no word frequencies. The same
 * word from several languages is kept once, and the prefix itself is dropped.
 */
export function rankWords(
  prefix: string,
  found: readonly { lang: Lang; words: readonly string[] }[],
) {
  const typed = prefix.normalize('NFC').toLowerCase()
  const capital = prefix[0] !== prefix[0]?.toLowerCase()
  const quality = (word: string, lang: Lang) =>
    Number(!word.toLowerCase().startsWith(typed)) * 4 +
    Number(/\s/.test(word)) * 2 +
    Number(lang !== 'de' && !capital && word[0] !== word[0]?.toLowerCase())
  const candidates = found.flatMap(({ lang, words }, order) =>
    words
      .filter((word) => word.length <= 64 && !/[\r\n]/.test(word))
      .map((word) => ({ word, lang, order, quality: quality(word, lang) })),
  )
  candidates.sort(
    (left, right) =>
      left.quality - right.quality ||
      left.order - right.order ||
      left.word.length - right.word.length ||
      left.word.localeCompare(right.word),
  )
  const seen = new Set([typed])
  const ranked: { word: string; lang: Lang }[] = []
  for (const { word, lang } of candidates) {
    const lower = word.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    ranked.push({ word, lang })
    if (ranked.length === MAX_ITEMS) break
  }
  return ranked
}

export type Complete = (
  langs: readonly Lang[],
  prefix: string,
  signal: AbortSignal,
  limit: number,
) => Promise<{ lang: Lang; words: string[] }[]>

/**
 * Word completions from the user's words, then the installed packs of every
 * suggestion language in one request per keystroke; nothing is sent online.
 */
export function dictionaryCompletions(
  complete: Complete,
  preferences: () => TypingPreferences,
  languageName: (lang: Lang) => string,
  custom: () => readonly CustomWord[] = () => [],
): CompletionProvider {
  return async (request, signal) => {
    const { anchor, head } = request.selection
    if (anchor !== head) return []
    const prefix = prefixAt(request.before, request.after)
    if (!prefix) return []
    signal.throwIfAborted()
    const settings = preferences()
    let found: { lang: Lang; words: string[] }[] = []
    try {
      found = await complete(settings.languages, prefix, signal, ASK)
    } catch (error) {
      // Packs that fail are skipped in the request; this is the request itself.
      if (signal.aborted) throw error
    }
    signal.throwIfAborted()
    // The user's words come before pack words for the same prefix, once each
    // across languages. Keys are compared in NFC; the typed prefix keeps its
    // own length for the replaced range.
    const fold = (word: string) => word.normalize('NFC').toLowerCase()
    const typed = fold(prefix)
    const taken = new Set<string>()
    const mine = custom()
      .filter(
        ({ word, lang }) =>
          (!lang || settings.languages.includes(lang)) &&
          fold(word) !== typed &&
          fold(word).startsWith(typed),
      )
      .map(({ word }) => word)
      .sort((left, right) => left.length - right.length)
      .filter((word) => !taken.has(fold(word)) && taken.add(fold(word)))
    const ranked = [
      ...mine.map((word) => ({ word, lang: null })),
      ...rankWords(prefix, found).filter(({ word }) => !taken.has(fold(word))),
    ].slice(0, MAX_ITEMS)
    const several = settings.languages.length > 1
    return ranked.map(
      ({ word, lang }): CompletionItem => ({
        label: word,
        ...(lang === null
          ? { detail: yours.label }
          : several
            ? { detail: languageName(lang) }
            : {}),
        insertText: matchCase(prefix, word),
        from: head - prefix.length,
        to: head,
        ...(settings.tabAccepts ? {} : { acceptOnTab: false }),
      }),
    )
  }
}

/** Keeps the completion provider registered only while suggestions are on. */
export function watchSuggestions(context: AddonContext) {
  let registered: Promise<(() => void) | undefined> | null = null
  const sync = () => {
    const on = readTyping().suggest
    if (on && !registered)
      registered = context.editor
        .registerCompletionProvider(
          dictionaryCompletions(
            (langs, prefix, signal, limit) =>
              completeAll(context.native, langs, prefix, signal, limit),
            readTyping,
            (lang) => languageNames[lang],
            listCustomWords,
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
