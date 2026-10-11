import type { DictionaryRegistry, Lang } from './providers.ts'

export type DictionaryWords = { lang: Lang; words: readonly string[] }
export type CustomWord = { word: string; lang: Lang }

/** Local vocabulary only. Explicit dictionary lookups are a separate feature. */
export interface DictionaryApi {
  readonly version: 1
  complete: (
    prefix: string,
    langs: readonly Lang[],
    limit: number,
    signal?: AbortSignal,
  ) => Promise<readonly DictionaryWords[]>
  suggestionLanguages: () => readonly Lang[]
  customWords: () => readonly CustomWord[]
}

export function createDictionaryApi(
  registry: DictionaryRegistry,
  suggestionLanguages: DictionaryApi['suggestionLanguages'],
  customWords: DictionaryApi['customWords'],
): DictionaryApi {
  return {
    version: 1,
    suggestionLanguages,
    customWords,
    async complete(
      prefix,
      langs,
      limit,
      signal = new AbortController().signal,
    ) {
      signal.throwIfAborted()
      if (!prefix.trim() || prefix.length > 64 || !Number.isFinite(limit))
        return []
      const count = Math.max(1, Math.min(64, Math.floor(limit)))
      return Promise.all(
        [...new Set(langs)].map(async (lang) => {
          const providers = await registry.providers(lang, 'lookup')
          signal.throwIfAborted()
          const provider = providers.find(
            (item) => item.kind === 'offline' && item.complete,
          )
          const words = provider?.complete
            ? await provider.complete(prefix, lang, signal, count)
            : []
          signal.throwIfAborted()
          return { lang, words }
        }),
      )
    },
  }
}
