import type { AddonStorageHandle } from '../../shared/addon-storage'
import type { AddonContext } from '../api'
import {
  type DictionaryProvider,
  type Entry,
  LANGS,
  type Lang,
} from './providers.ts'

/**
 * A word the user added. Without `lang`, it belongs to the word's first lookup
 * language. Listed words always have an `id` that stays the same when their
 * language or note changes.
 */
export type CustomWord = {
  id?: string
  word: string
  lang?: Lang
  note?: string
}

// `label` and `detail` fields are collected into the UI copy catalog.
export const yours = {
  label: 'Your word',
  detail: 'Added to your dictionary.',
}
const MAX_WORDS = 5000
const MAX_NOTE = 2000
const key = (word: CustomWord) =>
  `${word.word.normalize('NFC').toLowerCase()}\u0000${word.lang ?? ''}`

/** Valid words only, first spelling kept for each word and language. */
export function customWords(value: unknown, limit = MAX_WORDS): CustomWord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const words: CustomWord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { id, word, lang, note } = item as Record<string, unknown>
    if (typeof word !== 'string') continue
    const text = word.trim().normalize('NFC')
    if (!text || text.length > 64 || /[\p{Cc}]/u.test(text)) continue
    const entry: CustomWord = {
      ...(typeof id === 'string' && id && id.length <= 128 ? { id } : {}),
      word: text,
      ...(LANGS.includes(lang as Lang) ? { lang: lang as Lang } : {}),
      ...(typeof note === 'string' && note.trim()
        ? { note: note.trim().slice(0, MAX_NOTE) }
        : {}),
    }
    if (seen.has(key(entry))) continue
    seen.add(key(entry))
    words.push(Object.freeze(entry))
    if (words.length === limit) break
  }
  return words
}

/**
 * Gives each word a unique `id`. New words get a random one; words `loaded`
 * from before ids existed get one from their word and language, so it stays
 * the same until they are saved.
 */
function withIds(list: CustomWord[], loaded = false) {
  const ids = new Set<string>()
  return list.map((item) => {
    let id = item.id && !ids.has(item.id) ? item.id : loaded ? key(item) : ''
    if (!id || ids.has(id)) id = crypto.randomUUID()
    ids.add(id)
    return id === item.id ? item : Object.freeze({ ...item, id })
  })
}

let words: readonly CustomWord[] = Object.freeze([])
let handle: AddonStorageHandle<unknown> | null = null
let revision = 0
const listeners = new Set<() => void>()

function publish(next: CustomWord[]) {
  words = Object.freeze(next)
  for (const listener of listeners) listener()
}

/** The user's words, in the order they were added. Local only; never sent. */
export function listCustomWords(): readonly CustomWord[] {
  return words
}

export function onCustomWordsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Loads the saved words and follows changes made in other windows. */
export async function openCustomWords(context: AddonContext) {
  const opened = await context.storage.global<unknown>('custom-words', 1)
  handle = opened
  revision = 0
  sync()
  const stop = opened.subscribe(sync)
  return () => {
    stop()
    if (handle === opened) handle = null
    revision = 0
    publish([])
  }
}

/** Publishes the handle's latest words; an older revision never replaces a newer one. */
function sync() {
  const snapshot = handle?.snapshot()
  if (!snapshot) return
  if (snapshot.status === 'ready') {
    if (snapshot.revision < revision) return
    revision = snapshot.revision
  }
  publish(
    snapshot.status === 'ready'
      ? withIds(customWords(snapshot.value), true)
      : [],
  )
}

let saving: Promise<unknown> = Promise.resolve()

/**
 * Saves `change` applied to the latest list. Changes run one at a time, so a
 * quick edit after another never works from a stale list. Rejects with a
 * message the UI can show.
 */
export function updateCustomWords(
  change: (current: readonly CustomWord[]) => readonly CustomWord[],
) {
  const run = saving.then(async () => {
    if (!handle)
      throw new Error('Turn on Dictionary and thesaurus to keep custom words.')
    const next = withIds(customWords(change(words), Infinity))
    if (next.length > MAX_WORDS)
      throw new Error(
        'You can keep up to 5,000 custom words. Remove some to add more.',
      )
    const result = await handle.set(next)
    if (result.status === 'conflict')
      throw new Error('Custom words changed in another window. Try again.')
    if (result.status !== 'saved')
      throw new Error('Could not save custom words.')
    // A newer change from another window may have arrived before this reply.
    sync()
  })
  saving = run.catch(() => {})
  return run
}

/**
 * Applies `change` to the saved entry with `original`'s id when its turn
 * comes, so queued edits to different fields of one word all keep. Rejects
 * when the word is no longer listed.
 */
export function editCustomWord(
  original: CustomWord,
  change: (current: CustomWord) => CustomWord,
) {
  return updateCustomWords((current) => {
    const { id } = original
    const index = current.findIndex((item) => id && item.id === id)
    const item = current[index]
    if (!id || !item)
      throw new Error('This word was removed or changed in another window.')
    return current.with(index, { ...change(item), id })
  })
}

/** `incoming` words replace matching ones in place, keeping their ids; the rest are added at the end. */
export function mergeCustomWords(
  current: readonly CustomWord[],
  incoming: readonly CustomWord[],
) {
  const merged = new Map(current.map((item) => [key(item), item]))
  for (const { id: _id, ...item } of customWords(incoming, Infinity)) {
    const id = merged.get(key(item))?.id
    merged.set(key(item), id ? { ...item, id } : item)
  }
  return [...merged.values()]
}

/** Adds `word`, or updates its note when it is already listed. */
export function addCustomWord(word: CustomWord) {
  const added = customWords([word])
  if (!added.length) return Promise.reject(new Error('Enter a word to add.'))
  return updateCustomWords((current) => mergeCustomWords(current, added))
}

/**
 * One word per line: `word`, then optional tab-separated language code and
 * note. A backslash goes before a word starting with `#` (after any
 * backslashes) so it is not read back as a comment.
 */
export function exportCustomWords(list: readonly CustomWord[]) {
  return list
    .map((item) =>
      [
        item.word.replace(/^(?=\\*#)/, '\\'),
        item.lang ?? '',
        item.note?.replace(/\s+/g, ' ') ?? '',
      ]
        .join('\t')
        .trimEnd(),
    )
    .join('\n')
}

/** Parses exported text; blank lines and lines starting with `#` are skipped. */
export function importCustomWords(text: string) {
  return customWords(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
      .map((line) => {
        const [word = '', lang, ...note] = line.split('\t')
        return {
          word: word.trim().replace(/^\\(?=\\*#)/, ''),
          lang: lang?.trim(),
          note: note.join(' '),
        }
      }),
    Infinity,
  )
}

/**
 * Lookups for the user's words, marked as theirs. `first` names the language
 * a word without one belongs to, so it is answered once.
 */
export function customWordsProvider(
  first: (term: string) => Lang | undefined,
): DictionaryProvider {
  return {
    id: 'custom-words',
    label: 'Your words',
    kind: 'offline',
    languages: LANGS,
    async lookup(term, lang) {
      const wanted = term.trim().normalize('NFC').toLowerCase()
      return words
        .filter(
          (item) =>
            item.word.toLowerCase() === wanted &&
            (item.lang ?? first(item.word)) === lang,
        )
        .map(
          (item): Entry => ({
            term: item.word,
            lang,
            senses: [{ gloss: item.note ?? yours.detail }],
            source: { name: yours.label, license: '' },
          }),
        )
    },
  }
}
