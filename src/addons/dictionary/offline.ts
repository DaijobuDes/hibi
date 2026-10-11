import type { AddonContext } from '../api'
import type { PackEntry } from './pack-converters'
import { packIds, packs } from './packs.ts'
import {
  DictionaryError,
  type DictionaryProvider,
  type Source,
} from './providers.ts'
import { writeRecentPack } from './settings.ts'

export function createOfflineProviders(
  native: AddonContext['native'],
): DictionaryProvider[] {
  async function query<T>(
    method: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted()
    let abort = () => {}
    const canceled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      const result = await Promise.race([
        native.query<T>(method, input),
        canceled,
      ])
      signal.throwIfAborted()
      return result
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  return packIds.map((id) => {
    const spec = packs[id]
    const source: Source = {
      name: spec.sources.map((item) => item.name).join(' + '),
      license: [...new Set(spec.sources.map((item) => item.license))].join(
        ' + ',
      ),
      url: {
        en: 'https://en-word.net/',
        zh: 'https://www.mdbg.net/chinese/dictionary?page=cedict',
        yue: 'https://cantonese.org/download.html',
        ja: 'https://www.edrdg.org/jmdict/j_jmdict.html',
        tl: 'https://kaikki.org/dictionary/Tagalog/',
        fr: 'https://kaikki.org/dictionary/French/',
        de: 'https://kaikki.org/dictionary/German/',
      }[id],
    }
    async function read(term: string, signal: AbortSignal) {
      return query<PackEntry[]>('packLookup', { id, word: term }, signal)
    }
    const provider: DictionaryProvider = {
      id: `offline-${id}`,
      label: spec.label,
      kind: 'offline',
      languages: [id],
      installed: () => native.query<boolean>('packInstalled', id),
      async lookup(term, lang, signal) {
        if (lang !== id) return []
        try {
          const entries = await read(term, signal)
          if (entries.length) writeRecentPack(id)
          return entries.flatMap((entry) =>
            entry.meanings.map((meaning) => ({
              term: entry.word,
              lang,
              ...(entry.readings?.length
                ? { reading: entry.readings.join('; ') }
                : {}),
              ...(meaning.partOfSpeech
                ? { partOfSpeech: meaning.partOfSpeech }
                : {}),
              senses: meaning.definitions.map(({ definition, example }) => ({
                gloss: definition,
                ...(example ? { example } : {}),
              })),
              synonyms: meaning.synonyms,
              source:
                id === 'tl' || id === 'fr' || id === 'de'
                  ? {
                      ...source,
                      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}#${id === 'fr' ? 'French' : id === 'de' ? 'German' : 'Tagalog'}`,
                    }
                  : source,
            })),
          )
        } catch (error) {
          if (signal.aborted) throw error
          throw new DictionaryError('unavailable')
        }
      },
      async complete(prefix, lang, signal, limit = 8) {
        signal.throwIfAborted()
        if (lang !== id || !prefix.trim()) return []
        try {
          const words = await query<string[]>(
            'packComplete',
            { id, prefix, limit },
            signal,
          )
          if (words.length) writeRecentPack(id)
          return words
        } catch (error) {
          if (signal.aborted) throw error
          throw new DictionaryError('unavailable')
        }
      },
      async related(term, lang, signal) {
        if (lang !== id) return null
        const entries = await read(term, signal)
        const synonyms = [
          ...new Set(entries.flatMap((entry) => entry.synonyms)),
        ].filter((word) => word.toLowerCase() !== term.toLowerCase())
        const antonyms = [
          ...new Set(entries.flatMap((entry) => entry.antonyms)),
        ]
        return synonyms.length || antonyms.length
          ? {
              synonyms: synonyms.slice(0, 64),
              antonyms: antonyms.slice(0, 64),
              source,
            }
          : null
      },
    }
    return provider
  })
}
