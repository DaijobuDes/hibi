import type { AddonContext } from '../api'
import type { PackEntry } from './pack-converters'
import { type PackState, packIds, packs } from './packs.ts'
import {
  DictionaryError,
  type DictionaryProvider,
  type Source,
} from './providers.ts'

export function createOfflineProviders(
  native: AddonContext['native'],
): DictionaryProvider[] {
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
      }[id],
    }
    async function read(term: string, signal: AbortSignal) {
      signal.throwIfAborted()
      const entries = await native.query<PackEntry[]>('packLookup', {
        id,
        word: term,
      })
      signal.throwIfAborted()
      return entries
    }
    const provider: DictionaryProvider = {
      id: `offline-${id}`,
      label: spec.label,
      kind: 'offline',
      languages: [id],
      async installed() {
        const states = await native.query<PackState[]>('packs')
        return !!states.find((state) => state.id === id && state.manifest)
      },
      async lookup(term, lang, signal) {
        if (lang !== id) return []
        try {
          return (await read(term, signal)).flatMap((entry) =>
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
                id === 'tl' || id === 'fr'
                  ? {
                      ...source,
                      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}#${id === 'fr' ? 'French' : 'Tagalog'}`,
                    }
                  : source,
            })),
          )
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
