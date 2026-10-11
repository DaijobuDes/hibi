import type { HostTextRequest, HostTextResult } from '../../shared/host-network'
import { plainText } from './lookup.ts'
import {
  DictionaryError,
  type DictionaryProvider,
  type Entry,
  type Lang,
  type Related,
  type Source,
} from './providers.ts'

type GetText = (request: HostTextRequest) => Promise<HostTextResult>

/** Response text, or null when the service has no page for the request. */
async function read(getText: GetText, url: string) {
  let result: HostTextResult
  try {
    result = await getText({ url })
  } catch {
    throw new DictionaryError('unavailable')
  }
  if (result.ok) return result.value.text
  if (result.code === 'http-status' && result.status === 404) return null
  throw new DictionaryError(
    result.code === 'http-status'
      ? result.status === 429
        ? 'rate-limited'
        : 'unavailable'
      : result.code === 'permission-denied'
        ? 'denied'
        : result.code === 'timeout' || result.code === 'unavailable'
          ? 'offline'
          : 'unavailable',
  )
}

/** Closing the dialog stops follow-up requests; the host cannot cancel one in flight. */
function stopIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DictionaryError('unavailable')
}

/** Successful answers are kept for the session; failures are retried. */
function remember<T>(load: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>()
  return (key: string) => {
    let value = cache.get(key)
    if (!value) {
      value = load(key)
      cache.set(key, value)
      value.catch(() => cache.delete(key))
    }
    return value
  }
}

const wiktionarySection: Record<Lang, readonly string[]> = {
  en: ['en'],
  zh: ['zh'],
  // English Wiktionary files Cantonese senses under Chinese.
  yue: ['yue', 'zh'],
  ja: ['ja'],
  tl: ['tl'],
  fr: ['fr'],
}

/** Parses the Wiktionary REST definition response for one language. */
export function parseWiktionary(
  text: string,
  term: string,
  lang: Lang,
): Entry[] {
  const page: unknown = JSON.parse(text)
  if (!page || typeof page !== 'object' || Array.isArray(page))
    throw new SyntaxError()
  const sections = page as Record<string, unknown>
  const key = wiktionarySection[lang].find((code) =>
    Array.isArray(sections[code]),
  )
  const source: Source = {
    name: 'Wiktionary',
    license: 'CC BY-SA 4.0',
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`,
  }
  const entries: Entry[] = []
  for (const item of key ? (sections[key] as unknown[]) : []) {
    const usage = item as {
      partOfSpeech?: unknown
      definitions?: unknown
    } | null
    const senses = []
    for (const definition of Array.isArray(usage?.definitions)
      ? usage.definitions
      : []) {
      const gloss =
        typeof definition?.definition === 'string'
          ? plainText(definition.definition)
          : ''
      if (!gloss || senses.length >= 8) continue
      const raw = definition.parsedExamples?.[0]?.example
      const example = typeof raw === 'string' ? plainText(raw) : ''
      senses.push(example ? { gloss, example } : { gloss })
    }
    if (!senses.length) continue
    entries.push({
      term,
      lang: key === 'zh' ? 'zh' : lang,
      ...(typeof usage?.partOfSpeech === 'string'
        ? { partOfSpeech: usage.partOfSpeech.toLowerCase() }
        : {}),
      senses,
      source,
    })
    if (entries.length >= 8) break
  }
  return entries
}

/** Wikimedia asks for a descriptive User-Agent (sent by the host) and allows 200 requests a minute. */
export function wiktionaryProvider(getText: GetText): DictionaryProvider {
  const page = remember(async (term: string) =>
    read(
      getText,
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`,
    ),
  )
  return {
    id: 'wiktionary',
    label: 'Wiktionary',
    kind: 'online',
    languages: ['en', 'zh', 'yue', 'ja', 'tl', 'fr'],
    async lookup(term, lang, signal) {
      // Page titles are case-sensitive; a capital is usually sentence case.
      const lower = term.toLowerCase()
      for (const title of lower === term ? [term] : [lower, term]) {
        stopIfAborted(signal)
        const text = await page(title)
        stopIfAborted(signal)
        if (text === null) continue
        try {
          return parseWiktionary(text, title, lang)
        } catch {
          throw new DictionaryError('unavailable')
        }
      }
      return []
    },
  }
}

/** Parses a Datamuse word list, dropping the looked-up word itself. */
export function parseWords(text: string, word: string): string[] {
  const items: unknown = JSON.parse(text)
  if (!Array.isArray(items)) throw new SyntaxError()
  const words = new Set<string>()
  for (const item of items)
    if (
      typeof item?.word === 'string' &&
      item.word.trim() &&
      item.word.length <= 80 &&
      item.word.toLowerCase() !== word.toLowerCase() &&
      words.size < 24
    )
      words.add(item.word.trim())
  return [...words]
}

// ponytail: Datamuse is keyless up to 100,000 requests a day only until early
// 2027, when it will require an API key. Add a stored key or drop this source.
export function datamuseProvider(getText: GetText): DictionaryProvider {
  const list = remember((query: string) =>
    read(
      getText,
      `https://api.datamuse.com/words?${query}&max=24`,
    ),
  )
  const source: Source = {
    name: 'Datamuse',
    license: 'Datamuse API',
    url: 'https://www.datamuse.com/api/',
  }
  return {
    id: 'datamuse',
    label: 'Datamuse',
    kind: 'online',
    languages: ['en'],
    lookup: async () => [],
    async related(term, _lang, signal): Promise<Related | null> {
      const key = encodeURIComponent(term.toLowerCase())
      const words = async (relation: 'syn' | 'ant') => {
        stopIfAborted(signal)
        const text = await list(`rel_${relation}=${key}`)
        stopIfAborted(signal)
        if (text === null) return []
        try {
          return parseWords(text, term)
        } catch {
          throw new DictionaryError('unavailable')
        }
      }
      const synonyms = await words('syn')
      const antonyms = await words('ant')
      return synonyms.length || antonyms.length
        ? { synonyms, antonyms, source }
        : null
    },
  }
}
