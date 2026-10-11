import type { CompletionProvider } from '../../shared/completions.ts'
import type { DictionaryApi } from '../dictionary/api.ts'
import { matchCase } from '../dictionary/lookup.ts'
import type { Lang } from '../dictionary/providers.ts'
import type { createLearning } from './learning.ts'
import type { PersonalScope } from './model.ts'
import type { AutocompletePreferences } from './settings.ts'

const MIN_PREFIX = 3
const MAX_ITEMS = 8
const partial =
  /(?:^|[^\p{L}\p{M}'’-])(\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*)$/u

// Only quotes, brackets, and emphasis may open a prose word.
const opening = /^(?:[("'“‘*_~]|\[(?!\[))*$/u

function inCode(before: string, line: string) {
  return (
    (line.match(/`+/g)?.length ?? 0) % 2 === 1 ||
    (before.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 === 1
  )
}

/** The Latin-script prose word being typed, excluding commands, code, and urls. */
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

export type TypingSession = {
  scope: PersonalScope
  documentId: string
  personal: boolean
}

/** At most two contiguous words, never joined across punctuation or a sentence. */
export function precedingWords(before: string): string[] {
  const line = before.slice(before.lastIndexOf('\n') + 1).trimEnd()
  const tail = line.split(/[ \t]+/).slice(-2)
  const invalid = tail.findLastIndex(
    (word) => !/^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(word),
  )
  return tail.slice(invalid + 1)
}

export function autocompleteCompletions(
  dictionary: DictionaryApi,
  preferences: () => AutocompletePreferences,
  learning: Pick<ReturnType<typeof createLearning>, 'suggest' | 'epoch'>,
  session: () => TypingSession | null,
  languageName: (lang: Lang) => string,
): CompletionProvider {
  return async (request, signal) => {
    signal.throwIfAborted()
    const settings = preferences()
    const captured = session()
    const prose = request.prose
    const { anchor, head } = request.selection
    if (
      !settings.suggest ||
      !captured ||
      !prose ||
      anchor !== head ||
      captured.documentId !== request.view.documentId
    )
      return []
    const prefix = prefixAt(prose.before, prose.after)
    const nextWord =
      /[ \t]$/.test(prose.before) && !/^[\p{L}\p{M}]/u.test(prose.after)
    if (prefix === null && !nextWord) return []
    const typed = prefix ?? ''
    const context = precedingWords(
      prose.before.slice(0, prose.before.length - typed.length),
    )
    const epoch = learning.epoch()
    const langs = dictionary
      .suggestionLanguages()
      .filter((lang) => settings.languages.includes(lang))
    const found = typed
      ? await dictionary.complete(typed, langs, 24, signal).catch((error) => {
          if (signal.aborted) throw error
          return []
        })
      : []
    signal.throwIfAborted()
    if (
      session() !== captured ||
      preferences() !== settings ||
      learning.epoch() !== epoch
    )
      return []
    const baseline = rankWords(typed, found)
    const custom = dictionary
      .customWords()
      .filter(
        (item) =>
          langs.includes(item.lang) &&
          item.word.toLowerCase().startsWith(typed.toLowerCase()) &&
          item.word.toLowerCase() !== typed.toLowerCase(),
      )
      .slice(0, 64)
    const ranked = learning.suggest({
      scope: captured.scope,
      languages: langs,
      context,
      prefix: typed,
      baseline: [
        ...baseline,
        ...custom.map((item) => ({ ...item, custom: true })),
      ],
      enabled: settings.learning && captured.personal,
      limit: MAX_ITEMS,
    })
    const several = new Set(ranked.map((item) => item.lang)).size > 1
    return ranked.map(({ word, lang, score, source }) => ({
      label: word,
      ...(several ? { detail: languageName(lang) } : {}),
      insertText: source === 'personal' ? word : matchCase(typed, word),
      from: head - typed.length,
      to: head,
      rank: score * 100,
      ...(settings.tabAccepts ? {} : { acceptOnTab: false }),
    }))
  }
}
