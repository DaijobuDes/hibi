export const packIds = ['en', 'zh', 'yue', 'ja', 'tl', 'fr'] as const
export type PackId = (typeof packIds)[number]
export type PackSource = {
  name: string
  url: string
  license: string
  licenseUrl: string
  version: string
  bytes: number
  maxBytes: number
}
const mib = 1024 * 1024
const cedict: PackSource = {
  name: 'CC-CEDICT',
  url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  version: 'daily',
  bytes: 3980329,
  maxBytes: 16 * mib,
}
export const packs: Record<PackId, { label: string; sources: PackSource[] }> = {
  en: {
    label: 'English',
    sources: [
      {
        name: 'Open English WordNet',
        url: 'https://en-word.net/downloads/english-wordnet-2025.xml.gz',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        version: '2025',
        bytes: 11363503,
        maxBytes: 32 * mib,
      },
    ],
  },
  zh: { label: 'Mandarin · Simplified and Traditional', sources: [cedict] },
  yue: {
    label: 'Cantonese',
    sources: [
      {
        name: 'CC-Canto',
        url: 'https://cantonese.org/cccanto-170202.zip',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
        version: '2017-02-02',
        bytes: 1282537,
        maxBytes: 8 * mib,
      },
      {
        name: 'CC-CEDICT Cantonese readings',
        url: 'https://cantonese.org/cccedict-canto-readings-150923.zip',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
        version: '2015-09-23',
        bytes: 1874027,
        maxBytes: 8 * mib,
      },
      cedict,
    ],
  },
  ja: {
    label: 'Japanese',
    sources: [
      {
        name: 'JMdict',
        url: 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://www.edrdg.org/edrdg/licence.html',
        version: 'daily',
        bytes: 10583340,
        maxBytes: 32 * mib,
      },
    ],
  },
  fr: {
    label: 'French',
    sources: [
      {
        name: 'French Wiktionary via Kaikki',
        url: 'https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz',
        license: 'CC BY-SA 4.0 / GFDL',
        licenseUrl: 'https://kaikki.org/dictionary/French/',
        version: 'rolling',
        bytes: 58232930,
        maxBytes: 96 * mib,
      },
    ],
  },
  tl: {
    label: 'Filipino · Tagalog',
    sources: [
      {
        name: 'Wiktionary via Kaikki',
        url: 'https://kaikki.org/dictionary/Tagalog/kaikki.org-dictionary-Tagalog.jsonl.gz',
        license: 'CC BY-SA 4.0 / GFDL',
        licenseUrl: 'https://kaikki.org/dictionary/Tagalog/',
        version: 'rolling',
        bytes: 16281409,
        maxBytes: 32 * mib,
      },
    ],
  },
}
export type PackFile = { bytes: number; sha256: string }
export type PackManifest = {
  format: 1
  id: PackId
  installedAt: string
  sources: (PackSource & PackFile & { lastModified: string | null })[]
  entries: number
  keys: number
  data: PackFile
  index: PackFile
  convertMs: number
}
export type PackState = {
  id: PackId
  manifest: PackManifest | null
  phase: 'absent' | 'installed' | 'downloading' | 'converting' | 'error'
  bytes: number
  total: number | null
  entries: number
  error?: string
}
export function packId(value: unknown): PackId {
  if (typeof value !== 'string' || !packIds.includes(value as PackId))
    throw new Error('Choose a dictionary language pack.')
  return value as PackId
}
export function lookupInput(value: unknown): { id: PackId; word: string } {
  if (!value || typeof value !== 'object')
    throw new Error('Choose a word to look up.')
  const { id, word } = value as Record<string, unknown>
  if (
    typeof word !== 'string' ||
    !word.trim() ||
    word.length > 128 ||
    /\p{Cc}/u.test(word)
  )
    throw new Error('Choose a word of 128 characters or fewer.')
  return { id: packId(id), word: word.trim().normalize('NFC') }
}
export function validateManifest(value: unknown, id: PackId): PackManifest {
  const item = value as PackManifest | null
  const file = (value: PackFile | undefined, max: number) =>
    !!value &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= max &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  if (
    item?.format !== 1 ||
    item.id !== id ||
    typeof item.installedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.installedAt)) ||
    !Number.isSafeInteger(item.entries) ||
    item.entries < 1 ||
    item.entries > 1000000 ||
    !Number.isSafeInteger(item.keys) ||
    item.keys < 1 ||
    item.keys > 750000 ||
    !file(item.data, 512 * mib) ||
    !file(item.index, 48 * mib) ||
    !Number.isFinite(item.convertMs) ||
    item.convertMs < 0 ||
    !Array.isArray(item.sources) ||
    item.sources.length !== packs[id].sources.length ||
    item.sources.some((source, i) => {
      const expected = packs[id].sources[i]
      const legacy =
        (id === 'fr' || id === 'tl') &&
        source?.url === expected?.url.slice(0, -3)
      return (
        !expected ||
        !file(
          source,
          legacy ? (id === 'fr' ? 768 : 256) * mib : expected.maxBytes,
        ) ||
        (!legacy && source.url !== expected.url) ||
        source.name !== expected.name ||
        source.license !== expected.license ||
        source.licenseUrl !== expected.licenseUrl ||
        source.version !== expected.version ||
        (source.lastModified !== null &&
          (typeof source.lastModified !== 'string' ||
            source.lastModified.length > 128))
      )
    })
  )
    throw new Error(
      'This dictionary pack is damaged or outdated. Install it again.',
    )
  return item
}
