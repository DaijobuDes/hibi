import { decodeHTML } from 'entities'
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

const tagName = /\/?([a-z][\w-]*)/iy
const separates =
  /^(?:br|p|div|li|dd|dt|tr|td|th|h[1-6]|ul|ol|dl|table|blockquote|hr|section)$/i

/**
 * Plain text from a Wiktionary HTML fragment; results are rendered as text,
 * never HTML. One forward pass, so malformed markup cannot make it slow.
 */
export function plainText(html: string) {
  let text = ''
  let copied = 0
  let commentCanEnd = true
  let at = html.indexOf('<')
  while (at >= 0) {
    let end = -1
    let resume = at + 1
    let separator = ''
    if (html.startsWith('<!--', at)) {
      const close: number = commentCanEnd ? html.indexOf('-->', at + 4) : -1
      commentCanEnd = close >= 0
      if (commentCanEnd) end = close + 3
    } else {
      tagName.lastIndex = at + 1
      const name = tagName.exec(html)?.[1]
      if (name) {
        // Quoted attribute values may contain `>`.
        let index = tagName.lastIndex
        while (index < html.length && html[index] !== '>') {
          const quote = html[index]
          if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, index + 1)
            if (close < 0) break
            index = close
          }
          index++
        }
        if (html[index] === '>') end = index + 1
        // A later `<` inside an unterminated tag stops at the same place.
        else resume = index
        // Breaks and blocks separate words.
        if (separates.test(name)) separator = ' '
      }
    }
    if (end >= 0) {
      text += html.slice(copied, at) + separator
      copied = resume = end
    }
    at = html.indexOf('<', resume)
  }
  return decodeHTML(text + html.slice(copied))
    .replace(/\s+/g, ' ')
    .trim()
}
