import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip } from 'node:zlib'
import { openBoundedZip, readZipEntry } from '../../main/zip-reader.ts'

export type PackEntry = {
  word: string
  keys: string[]
  readings?: string[]
  meanings: {
    partOfSpeech: string
    definitions: { definition: string; example?: string }[]
    synonyms: string[]
  }[]
  synonyms: string[]
  antonyms: string[]
}

const MAX_RECORD = 2 * 1024 * 1024
const MAX_BYTES = 512 * 1024 * 1024
const MAX_RECORDS = 3_000_000
const unique = (items: string[]) => [...new Set(items.filter(Boolean))]
const meaning = (
  definitions: string[],
  partOfSpeech = '',
  synonyms: string[] = [],
) => ({
  partOfSpeech,
  definitions: definitions.map((definition) => ({ definition })),
  synonyms,
})
function entry(
  word: string,
  keys: string[],
  meanings: PackEntry['meanings'],
  readings?: string[],
): PackEntry {
  if (!word || !meanings.some((m) => m.definitions.length))
    throw new Error('dictionary record has no word or definitions')
  return {
    word: word.normalize('NFC'),
    keys: unique([word, ...keys].map((key) => key.normalize('NFC'))),
    meanings,
    ...(readings ? { readings } : {}),
    synonyms: unique(meanings.flatMap((m) => m.synonyms)),
    antonyms: [],
  }
}

async function* chunks(path: string, maxBytes = MAX_BYTES) {
  const file = await open(path, 'r')
  const magic = Buffer.alloc(4)
  let length: number
  try {
    await file.read(magic, 0, 4, 0)
    length = (await file.stat()).size
    if (magic.readUInt32LE() === 0x04034b50) {
      if (length > 64 * 1024 * 1024)
        throw new Error('dictionary ZIP size limit exceeded')
      const directory = await openBoundedZip(await file.readFile(), 1)
      const member = directory.files[0]
      if (member?.type !== 'File' || !member.path.endsWith('.txt'))
        throw new Error('invalid dictionary ZIP member')
      const buffer = await readZipEntry(member, 64 * 1024 * 1024)
      const decoder = new StringDecoder('utf8')
      for (let offset = 0; offset < buffer.length; offset += 64 * 1024)
        yield decoder.write(buffer.subarray(offset, offset + 64 * 1024))
      yield decoder.end()
      return
    }
  } finally {
    await file.close()
  }
  const source = createReadStream(path, { highWaterMark: 64 * 1024 })
  const gzip =
    magic[0] === 0x1f && magic[1] === 0x8b ? createGunzip() : undefined
  const stream = gzip ? source.pipe(gzip) : source
  source.on('error', (error) => stream.destroy(error))
  const decoder = new StringDecoder('utf8')
  let bytes = 0
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > maxBytes)
        throw new Error('dictionary decompression size limit exceeded')
      yield decoder.write(chunk)
    }
    yield decoder.end()
  } finally {
    source.destroy()
    gzip?.destroy()
  }
}

async function* lines(path: string, maxBytes = MAX_BYTES) {
  let pending = ''
  let count = 0
  for await (const chunk of chunks(path, maxBytes)) {
    pending += chunk
    let end = pending.indexOf('\n')
    while (end !== -1) {
      if (end > MAX_RECORD || ++count > MAX_RECORDS)
        throw new Error('dictionary record limit exceeded')
      if (end) yield pending.slice(0, end).replace(/\r$/, '')
      pending = pending.slice(end + 1)
      end = pending.indexOf('\n')
    }
    if (pending.length > MAX_RECORD)
      throw new Error('dictionary record size limit exceeded')
  }
  if (pending) {
    if (++count > MAX_RECORDS)
      throw new Error('dictionary record count limit exceeded')
    yield pending
  }
}

type Xml = {
  name: string
  attrs: Record<string, string>
  text: string
  children: Xml[]
}
const children = (node: Xml, name: string) =>
  node.children.filter((child) => child.name === name)
const texts = (node: Xml, name: string) =>
  children(node, name).map((child) => child.text.trim())
function decode(text: string, entities: Map<string, string>) {
  return text.replace(/&([^;\s]+);|&/g, (_, key: string | undefined) => {
    if (!key) throw new Error('malformed XML entity')
    const value = entities.get(key)
    if (value !== undefined) return value
    if (/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(key)) {
      const code =
        key[1] === 'x'
          ? Number.parseInt(key.slice(2), 16)
          : Number(key.slice(1))
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))
        return String.fromCodePoint(code)
    }
    throw new Error('unknown XML entity')
  })
}

// Only bounded, literal internal entities are read; external DTDs are never loaded.
async function* xmlRecords(path: string, names: string[], root: string) {
  const entities = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
  ])
  const stack: string[] = []
  const nodes: Xml[] = []
  let pending = ''
  let size = 0
  let count = 0
  let seenRoot = false
  for await (const chunk of chunks(path)) {
    pending += chunk
    while (pending) {
      let end: number
      if (pending[0] !== '<') {
        end = pending.indexOf('<')
        if (end === -1) break
        const text = decode(pending.slice(0, end), entities)
        const current = nodes.at(-1)
        if (current) current.text += text
        else if (!stack.length && text.trim())
          throw new Error('unexpected XML text')
      } else if (pending.startsWith('<!--')) {
        end = pending.indexOf('-->')
        if (end === -1) break
        end += 3
      } else if (pending.startsWith('<?')) {
        end = pending.indexOf('?>')
        if (end === -1) break
        end += 2
      } else if (pending.startsWith('<!DOCTYPE')) {
        let quote = ''
        let depth = 0
        end = -1
        for (let i = 9; i < pending.length; i++) {
          const c = pending[i]
          if (quote) {
            if (c === quote) quote = ''
          } else if (c === '"' || c === "'") quote = c
          else if (c === '[') depth++
          else if (c === ']') depth--
          else if (c === '>' && depth === 0) {
            end = i + 1
            break
          }
        }
        if (end === -1) break
        const dtd = pending.slice(0, end)
        if (/<!ENTITY\s+%|<!ENTITY\s+[^>]*\b(?:SYSTEM|PUBLIC)\b/i.test(dtd))
          throw new Error('external XML entities forbidden')
        for (const match of dtd.matchAll(
          /<!ENTITY\s+([\w-]+)\s+(["'])(.*?)\2\s*>/gs,
        )) {
          const [, name = '', , value = ''] = match
          if (
            value.includes('&') ||
            value.length > 1024 ||
            entities.size > 1024
          )
            throw new Error('XML entity expansion forbidden')
          entities.set(name, value)
        }
      } else {
        end = pending.indexOf('>')
        if (end === -1) break
        end++
        const token = pending.slice(0, end)
        const close = /^<\/([\w:.-]+)\s*>$/.exec(token)
        if (close) {
          if (stack.pop() !== close[1])
            throw new Error('malformed XML closing tag')
          if (nodes.length) {
            const node = nodes.pop()
            if (!node || node.name !== close[1])
              throw new Error('malformed XML record')
            if (!nodes.length) {
              if (++count > MAX_RECORDS)
                throw new Error('dictionary record count limit exceeded')
              yield node
              size = 0
            }
          }
        } else {
          const open =
            /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(
              token,
            )
          if (!open) throw new Error('malformed XML tag')
          const name = open[1] ?? ''
          if (!stack.length) {
            if (seenRoot || name !== root) throw new Error('invalid XML root')
            seenRoot = true
          }
          const attrs: Record<string, string> = {}
          for (const match of (open[2] ?? '').matchAll(
            /([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs,
          )) {
            const [, key = '', , value = ''] = match
            attrs[key] = decode(value, entities)
          }
          if (nodes.length || names.includes(name)) {
            const node = { name, attrs, text: '', children: [] }
            nodes.at(-1)?.children.push(node)
            if (!open[3]) nodes.push(node)
          }
          if (!open[3]) stack.push(name)
          if (stack.length > 64) throw new Error('XML depth limit exceeded')
        }
      }
      if (nodes.length) {
        size += end
        if (size > MAX_RECORD)
          throw new Error('dictionary record size limit exceeded')
      }
      pending = pending.slice(end)
    }
    if (pending.length > MAX_RECORD)
      throw new Error('dictionary record size limit exceeded')
  }
  if (stack.length || pending.trim() || !seenRoot)
    throw new Error('truncated XML dictionary')
}

const posNames: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  s: 'adjective',
  r: 'adverb',
}

async function* english(path: string) {
  const synsets = new Map<
    string,
    { definitions: string[]; examples: string[]; words: string[] }
  >()
  const members = new Map<string, string[]>()
  const senseWords = new Map<string, string>()
  let retained = 0
  for await (const node of xmlRecords(
    path,
    ['LexicalEntry', 'Synset'],
    'LexicalResource',
  )) {
    if (node.name === 'Synset') {
      const definitions = texts(node, 'Definition')
      const examples = texts(node, 'Example')
      const id = node.attrs.id
      if (!id) throw new Error('invalid WordNet synset')
      retained +=
        id.length + definitions.join('').length + examples.join('').length
      synsets.set(id, { definitions, examples, words: [] })
    } else {
      const word = children(node, 'Lemma')[0]?.attrs.writtenForm
      if (!word) throw new Error('invalid WordNet lemma')
      for (const sense of children(node, 'Sense')) {
        const id = sense.attrs.synset
        if (!id || !sense.attrs.id) throw new Error('invalid WordNet sense')
        senseWords.set(sense.attrs.id, word)
        retained += word.length + id.length + sense.attrs.id.length
        const words = members.get(id) ?? []
        words.push(word)
        members.set(id, words)
      }
    }
    if (
      members.size + synsets.size > 500_000 ||
      senseWords.size > 500_000 ||
      retained > 96 * 1024 * 1024
    )
      throw new Error('WordNet retained data limit exceeded')
  }
  for (const [id, words] of members) {
    const synset = synsets.get(id)
    if (!synset) throw new Error('missing WordNet synset')
    synset.words = unique(words)
  }
  members.clear()
  for await (const node of xmlRecords(
    path,
    ['LexicalEntry'],
    'LexicalResource',
  )) {
    const lemma = children(node, 'Lemma')[0]
    const word = lemma?.attrs.writtenForm
    if (!word) throw new Error('invalid WordNet lemma')
    const meanings = children(node, 'Sense').map((sense) => {
      const synset = synsets.get(sense.attrs.synset ?? '')
      if (!synset) throw new Error('missing WordNet synset')
      return {
        partOfSpeech:
          posNames[lemma.attrs.partOfSpeech ?? ''] ??
          lemma.attrs.partOfSpeech ??
          '',
        definitions: synset.definitions.map((definition, i) => ({
          definition,
          ...(synset.examples[i] ? { example: synset.examples[i] } : {}),
        })),
        synonyms: synset.words.filter((value) => value !== word),
      }
    })
    const forms = children(node, 'Form').map(
      (form) => form.attrs.writtenForm ?? '',
    )
    const result = entry(
      word,
      unique([word, ...forms].flatMap((value) => [value, value.toLowerCase()])),
      meanings,
    )
    result.antonyms = unique(
      children(node, 'Sense').flatMap((sense) =>
        children(sense, 'SenseRelation')
          .filter((relation) => relation.attrs.relType === 'antonym')
          .map((relation) => {
            const target = senseWords.get(relation.attrs.target ?? '')
            if (!target) throw new Error('missing WordNet antonym target')
            return target
          }),
      ),
    )
    yield result
  }
}

type Cedict = {
  traditional: string
  simplified: string
  pinyin: string
  reading: string | undefined
  definitions: string[]
}
function cedict(line: string): Cedict | undefined {
  if (!line.trim() || line.trimStart().startsWith('#')) return
  const match =
    /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s*(?:\{(.+?)\}\s*)?(?:\/(.*)\/)?\s*(?:#.*)?$/.exec(
      line,
    )
  if (!match) throw new Error('malformed CEDICT record')
  return {
    traditional: match[1] ?? '',
    simplified: match[2] ?? '',
    pinyin: match[3] ?? '',
    reading: match[4]?.replace(/[{}]/g, ''),
    definitions: match[5]?.split('/').filter(Boolean) ?? [],
  }
}

const readingKey = (row: Cedict) =>
  `${row.traditional}\0${row.simplified}\0${row.pinyin.replace(/\s/g, '')}`

async function* chinese(paths: string[], cantonese: boolean) {
  const readings = new Map<string, string[]>()
  let retained = 0
  if (cantonese) {
    for (const path of paths)
      for await (const line of lines(path)) {
        const row = cedict(line)
        if (row?.reading) {
          const key = readingKey(row)
          readings.set(key, unique([...(readings.get(key) ?? []), row.reading]))
          retained += key.length + row.reading.length
          if (readings.size > 500_000 || retained > 96 * 1024 * 1024)
            throw new Error('Cantonese reading limit exceeded')
        }
      }
  }
  for (const path of paths)
    for await (const line of lines(path)) {
      const row = cedict(line)
      if (!row) continue
      if (!row.definitions.length) {
        if (!cantonese || !row.reading)
          throw new Error('CEDICT record has no definitions')
        continue
      }
      const reading = cantonese ? readings.get(readingKey(row)) : [row.pinyin]
      if (cantonese && !reading?.length) continue
      yield entry(
        row.simplified,
        [row.traditional],
        [meaning(row.definitions)],
        reading,
      )
    }
}

async function* japanese(path: string) {
  for await (const node of xmlRecords(path, ['entry'], 'JMdict')) {
    const spellings = children(node, 'k_ele').flatMap((element) =>
      texts(element, 'keb'),
    )
    const readings = children(node, 'r_ele').flatMap((element) =>
      texts(element, 'reb'),
    )
    let pos = ''
    const meanings = children(node, 'sense')
      .map((sense) => {
        const positions = texts(sense, 'pos')
        if (positions.length) pos = positions.join(', ')
        const glosses = children(sense, 'gloss')
          .filter(
            (gloss) =>
              !gloss.attrs['xml:lang'] || gloss.attrs['xml:lang'] === 'eng',
          )
          .map((gloss) => gloss.text.trim())
        return meaning(glosses, pos)
      })
      .filter((value) => value.definitions.length)
    yield entry(
      spellings[0] ?? readings[0] ?? '',
      [...spellings, ...readings],
      meanings,
      readings,
    )
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    typeof item === 'string'
      ? [item]
      : item && typeof item.word === 'string'
        ? [item.word]
        : [],
  )
}
async function* kaikki(path: string, id: 'tl' | 'fr') {
  for await (const line of lines(
    path,
    id === 'fr' ? 768 * 1024 * 1024 : MAX_BYTES,
  )) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    if (!row || typeof row.word !== 'string' || !Array.isArray(row.senses))
      throw new Error('malformed Kaikki record')
    if (row.lang_code && row.lang_code !== id) continue
    const meanings: PackEntry['meanings'] = row.senses
      .map((sense: Record<string, unknown>) => {
        const value = meaning(
          stringList(sense.glosses),
          typeof row.pos === 'string' ? row.pos : '',
          stringList(sense.synonyms),
        )
        const examples = sense.examples
        const example = Array.isArray(examples)
          ? examples.find((item) => item && typeof item.text === 'string')?.text
          : undefined
        return {
          ...value,
          definitions: value.definitions.map((definition) => ({
            ...definition,
            ...(example ? { example } : {}),
          })),
        }
      })
      .filter(
        (value: PackEntry['meanings'][number]) => value.definitions.length,
      )
    if (!meanings.length) continue
    const result = entry(row.word, [row.word.toLowerCase()], meanings)
    result.synonyms = unique([...result.synonyms, ...stringList(row.synonyms)])
    result.antonyms = unique([
      ...stringList(row.antonyms),
      ...row.senses.flatMap((sense: Record<string, unknown>) =>
        stringList(sense.antonyms),
      ),
    ])
    yield result
  }
}

/** Converts downloaded source files; gzip streams and records have fixed bounds. */
export async function* convertEntries(
  id: 'en' | 'zh' | 'yue' | 'ja' | 'tl' | 'fr',
  paths: string[],
): AsyncGenerator<PackEntry> {
  const first = paths[0]
  if (!first || paths.length > 8)
    throw new Error('invalid dictionary source paths')
  let count = 0
  const converter =
    id === 'en'
      ? english(first)
      : id === 'ja'
        ? japanese(first)
        : id === 'tl' || id === 'fr'
          ? kaikki(first, id)
          : id === 'zh' || id === 'yue'
            ? chinese(paths, id === 'yue')
            : undefined
  if (!converter) throw new Error('unknown dictionary language')
  for await (const result of converter) {
    if (++count > MAX_RECORDS)
      throw new Error('dictionary entry count limit exceeded')
    yield result
  }
  if (!count) throw new Error('dictionary contains no entries')
}
