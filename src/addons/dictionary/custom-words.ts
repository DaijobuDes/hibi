import type { AddonStorageHandle } from '../../shared/addon-storage'
import type { AddonContext } from '../api'
import {
  type DictionaryProvider,
  type Entry,
  LANGS,
  type Lang,
} from './providers.ts'

/** A word the user added. Without `lang`, it belongs to the word's first lookup language. */
export type CustomWord = { word: string; lang?: Lang; note?: string }

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
export function customWords(value: unknown): CustomWord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const words: CustomWord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { word, lang, note } = item as Record<string, unknown>
    if (typeof word !== 'string') continue
    const text = word.trim().normalize('NFC')
    if (!text || text.length > 64 || /[\p{Cc}]/u.test(text)) continue
    const entry: CustomWord = {
      word: text,
      ...(LANGS.includes(lang as Lang) ? { lang: lang as Lang } : {}),
      ...(typeof note === 'string' && note.trim()
        ? { note: note.trim().slice(0, MAX_NOTE) }
        : {}),
    }
    if (seen.has(key(entry))) continue
    seen.add(key(entry))
    words.push(Object.freeze(entry))
    if (words.length === MAX_WORDS) break
  }
  return words
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
  publish(snapshot.status === 'ready' ? customWords(snapshot.value) : [])
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
    const result = await handle.set(customWords(change(words)))
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

/** True when both name the same word in the same language. */
export const sameCustomWord = (left: CustomWord, right: CustomWord) =>
  key(left) === key(right)

/** `incoming` words replace matching ones in place; the rest are added at the end. */
export function mergeCustomWords(
  current: readonly CustomWord[],
  incoming: readonly CustomWord[],
) {
  const merged = new Map(current.map((item) => [key(item), item]))
  for (const item of customWords(incoming)) merged.set(key(item), item)
  return [...merged.values()]
}

/** Adds `word`, or updates its note when it is already listed. */
export function addCustomWord(word: CustomWord) {
  const added = customWords([word])
  if (!added.length) return Promise.reject(new Error('Enter a word to add.'))
  return updateCustomWords((current) => mergeCustomWords(current, added))
}

/** One word per line: `word`, then optional tab-separated language code and note. */
export function exportCustomWords(list: readonly CustomWord[]) {
  return list
    .map((item) =>
      [item.word, item.lang ?? '', item.note?.replace(/\s+/g, ' ') ?? '']
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
        const [word, lang, ...note] = line.split('\t')
        return { word, lang: lang?.trim(), note: note.join(' ') }
      }),
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
