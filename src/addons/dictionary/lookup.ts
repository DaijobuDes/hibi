import type { Lang } from './providers'

/** One word in a live editor; replace fails if the document changed. */
export type LookupTarget = {
  word: string
  replace: (text: string) => boolean
  focus: () => void
}

/** Which language a word in each script is looked up in first. */
export type LanguagePreferences = {
  han: 'zh' | 'yue' | 'ja'
  latin: 'en' | 'tl' | 'fr'
}

const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const han = /\p{Script=Han}/u
const letter = /\p{L}/u

const ordered = <T extends Lang>(first: T, all: readonly T[]) => [
  first,
  ...all.filter((lang) => lang !== first),
]

/** Candidate languages in preference order; empty for unsupported scripts such as Hangul. */
export function detectLangs(
  term: string,
  preferences: LanguagePreferences,
): Lang[] {
  if (/\p{Script=Hangul}/u.test(term)) return []
  if (kana.test(term)) return ['ja']
  if (han.test(term)) return ordered(preferences.han, ['zh', 'yue', 'ja'])
  if (/\p{Script=Latin}/u.test(term))
    return ordered(preferences.latin, ['en', 'tl', 'fr'])
  return []
}

/** Segmenter locale for the text around a caret; scripts without spaces need it. */
export function segmentLocale(text: string, preferences: LanguagePreferences) {
  if (kana.test(text)) return 'ja'
  if (han.test(text))
    return { zh: 'zh', yue: 'zh-Hant', ja: 'ja' }[preferences.han]
  return 'en'
}

/**
 * Expands a caret to the word around it, or trims a selection, which is looked
 * up as written. Offsets are in `text`.
 */
export function wordAt(
  text: string,
  from: number,
  to: number,
  preferences: LanguagePreferences,
) {
  if (from !== to) {
    const selected = text.slice(from, to)
    const word = selected.trim()
    const start = from + selected.indexOf(word)
    return word.length <= 64 && letter.test(word) && !/[\r\n]/.test(word)
      ? { from: start, to: start + word.length, word }
      : null
  }
  // Long paragraphs only need the text near the caret.
  const offset = Math.max(0, from - 64)
  const near = text.slice(offset, from + 64)
  const caret = from - offset
  // Inside a word wins, then the word ending at the caret, then the one after it.
  let before: { from: number; to: number; word: string } | null = null
  for (const part of new Intl.Segmenter(segmentLocale(near, preferences), {
    granularity: 'word',
  }).segment(near)) {
    if (part.index > caret) break
    const end = part.index + part.segment.length
    if (!part.isWordLike || !letter.test(part.segment) || end < caret) continue
    const found = {
      from: offset + part.index,
      to: offset + end,
      word: part.segment,
    }
    if (part.index < caret && caret < end) return found
    if (end === caret) before = found
    else return before ?? found
  }
  return before
}

/** Capitalizes the replacement when the original word starts with a capital. */
export function matchCase(original: string, replacement: string) {
  const [first = ''] = original
  const [head = '', ...rest] = replacement
  return first !== first.toLowerCase()
    ? head.toUpperCase() + rest.join('')
    : replacement
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Plain text from a Wiktionary HTML fragment; results are rendered as text, never HTML. */
export function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name[0] !== '#') return entities[name.toLowerCase()] ?? match
      const code = Number.parseInt(
        name.slice(name[1] === 'x' || name[1] === 'X' ? 2 : 1),
        name[1] === 'x' || name[1] === 'X' ? 16 : 10,
      )
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/\s+/g, ' ')
    .trim()
}
