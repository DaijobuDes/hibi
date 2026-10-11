import type { HostTextRequest, HostTextResult } from '../../shared/host-network'

// ponytail: English lookups need the network and two free services. Bundle an
// offline lexicon, such as a WordNet download, if they become unreliable.
export type Meaning = {
  partOfSpeech: string
  definitions: { definition: string; example?: string }[]
  synonyms: string[]
}
export type Definitions = { meanings: Meaning[]; license?: string }
export type Thesaurus = { synonyms: string[]; antonyms: string[] }
export type LookupFailure =
  | 'offline'
  | 'rate-limited'
  | 'denied'
  | 'unavailable'
/** A null value means the service has no entry for the word. */
export type Lookup<T> =
  | { ok: true; value: T | null }
  | { ok: false; reason: LookupFailure }

/** One word in a live editor; replace fails if the document changed. */
export type LookupTarget = {
  word: string
  replace: (text: string) => boolean
  focus: () => void
}

const letter = /[\p{L}\p{M}]/u
const inner = /[\p{L}\p{M}'’-]/u

/** Expands a caret or trims a selection to one word; offsets are in `text`. */
export function wordAt(text: string, from: number, to: number) {
  if (from === to) {
    while (from > 0 && inner.test(text.charAt(from - 1))) from--
    while (to < text.length && inner.test(text.charAt(to))) to++
  }
  while (from < to && !letter.test(text.charAt(from))) from++
  while (to > from && !letter.test(text.charAt(to - 1))) to--
  const word = text.slice(from, to)
  return word.length <= 64 && /^[\p{L}\p{M}'’-]+$/u.test(word)
    ? { from, to, word }
    : null
}

/** Capitalizes the replacement when the original word starts with a capital. */
export function matchCase(original: string, replacement: string) {
  const [first = ''] = original
  const [head = '', ...rest] = replacement
  return first !== first.toLowerCase()
    ? head.toUpperCase() + rest.join('')
    : replacement
}

function words(values: unknown, limit: number, exclude = '') {
  const result = new Set<string>()
  for (const value of Array.isArray(values) ? values : [])
    if (
      typeof value === 'string' &&
      value.trim() &&
      value.length <= 80 &&
      value.toLowerCase() !== exclude &&
      result.size < limit
    )
      result.add(value.trim())
  return [...result]
}

/** Parses a Free Dictionary API entry list, merging meanings by part of speech. */
export function parseDefinitions(text: string): Definitions | null {
  const entries: unknown = JSON.parse(text)
  if (!Array.isArray(entries)) throw new SyntaxError()
  const meanings = new Map<string, Meaning>()
  let license: string | undefined
  for (const entry of entries) {
    if (typeof entry?.license?.name === 'string') license ??= entry.license.name
    for (const meaning of Array.isArray(entry?.meanings)
      ? entry.meanings
      : []) {
      const partOfSpeech =
        typeof meaning?.partOfSpeech === 'string' ? meaning.partOfSpeech : ''
      const current: Meaning = meanings.get(partOfSpeech) ?? {
        partOfSpeech,
        definitions: [],
        synonyms: [],
      }
      meanings.set(partOfSpeech, current)
      const synonyms = [...current.synonyms, ...words(meaning.synonyms, 12)]
      for (const item of Array.isArray(meaning.definitions)
        ? meaning.definitions
        : []) {
        if (typeof item?.definition !== 'string' || !item.definition.trim())
          continue
        synonyms.push(...words(item.synonyms, 12))
        if (current.definitions.length < 8)
          current.definitions.push({
            definition: item.definition.trim(),
            ...(typeof item.example === 'string' && item.example.trim()
              ? { example: item.example.trim() }
              : {}),
          })
      }
      current.synonyms = words(synonyms, 12)
    }
  }
  const result = [...meanings.values()].filter(
    (meaning) => meaning.definitions.length,
  )
  return result.length
    ? { meanings: result, ...(license ? { license } : {}) }
    : null
}

/** Parses a Datamuse word list, dropping the looked-up word itself. */
export function parseWords(text: string, word: string): string[] {
  const items: unknown = JSON.parse(text)
  if (!Array.isArray(items)) throw new SyntaxError()
  return words(
    items.map((item) => item?.word),
    24,
    word.toLowerCase(),
  )
}

type GetText = (request: HostTextRequest) => Promise<HostTextResult>

async function read(getText: GetText, url: string): Promise<Lookup<string>> {
  let result: HostTextResult
  try {
    result = await getText({ url })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (result.ok) return { ok: true, value: result.value.text }
  if (result.code === 'http-status')
    return result.status === 404
      ? { ok: true, value: null }
      : {
          ok: false,
          reason: result.status === 429 ? 'rate-limited' : 'unavailable',
        }
  return {
    ok: false,
    reason:
      result.code === 'permission-denied'
        ? 'denied'
        : result.code === 'timeout' || result.code === 'unavailable'
          ? 'offline'
          : 'unavailable',
  }
}

function parsed<T>(
  response: Lookup<string>,
  parse: (text: string) => T,
): Lookup<T> {
  if (!response.ok || response.value === null) return response as Lookup<T>
  try {
    return { ok: true, value: parse(response.value) }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Sends one request per user lookup and keeps answers for this session only. */
export function createLookups(getText: GetText) {
  const cache = new Map<string, Lookup<unknown>>()
  async function cached<T>(key: string, load: () => Promise<Lookup<T>>) {
    const hit = cache.get(key)
    if (hit) return hit as Lookup<T>
    const result = await load()
    if (result.ok) cache.set(key, result)
    return result
  }
  const keyOf = (word: string) => word.toLowerCase().replaceAll('’', "'")
  return {
    define(word: string) {
      const key = keyOf(word)
      return cached(`define:${key}`, async () =>
        parsed(
          await read(
            getText,
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
          ),
          parseDefinitions,
        ),
      )
    },
    thesaurus(word: string) {
      const key = keyOf(word)
      const list = async (relation: 'syn' | 'ant') =>
        parsed(
          await read(
            getText,
            `https://api.datamuse.com/words?rel_${relation}=${encodeURIComponent(key)}&max=24`,
          ),
          (text) => parseWords(text, key),
        )
      return cached<Thesaurus>(`thesaurus:${key}`, async () => {
        const synonyms = await list('syn')
        if (!synonyms.ok) return synonyms
        const antonyms = await list('ant')
        if (!antonyms.ok) return antonyms
        const value = {
          synonyms: synonyms.value ?? [],
          antonyms: antonyms.value ?? [],
        }
        return {
          ok: true,
          value: value.synonyms.length || value.antonyms.length ? value : null,
        }
      })
    },
  }
}
