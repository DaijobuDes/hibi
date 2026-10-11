import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { convertEntries } from '../src/addons/dictionary/pack-converters.ts'
import { zipFiles } from './zip.mjs'

const fixture = (name) =>
  fileURLToPath(new URL(`./fixtures/dictionary-packs/${name}`, import.meta.url))
const collect = async (id, paths) => Array.fromAsync(convertEntries(id, paths))
async function temporary(t, content, name = 'source-0') {
  const directory = await mkdtemp(join(tmpdir(), 'hibi-dictionary-converter-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, name)
  await writeFile(path, content)
  return path
}

test('english joins official synsets, synonyms, examples, antonyms and irregular forms', async () => {
  const entries = await collect('en', [fixture('en.xml')])
  const byWord = new Map(entries.map((entry) => [entry.word, entry]))
  assert.equal(entries.length, 23)
  for (const [word, form] of [
    ['go', 'went'],
    ['child', 'children'],
    ['mouse', 'mice'],
  ]) {
    assert.equal(byWord.get(word).keys[0], word)
    assert.ok(byWord.get(word).keys.includes(form))
  }
  const dog = byWord.get('dog')
  assert.deepEqual(dog.synonyms, ['Canis familiaris', 'domestic dog'])
  assert.deepEqual(dog.meanings[0].synonyms, dog.synonyms)
  assert.equal(dog.meanings[0].partOfSpeech, 'noun')
  assert.equal(
    dog.meanings[0].definitions[0].example,
    'the dog barked all night',
  )
  assert.deepEqual(byWord.get('happy').antonyms, ['unhappy'])
  assert.deepEqual(byWord.get('unhappy').antonyms, ['happy'])
  assert.deepEqual(byWord.get('Canis familiaris').keys, [
    'Canis familiaris',
    'canis familiaris',
  ])
})

test('mandarin preserves distinct readings and traditional/simplified aliases', async () => {
  const entries = await collect('zh', [fixture('zh.txt')])
  const cats = entries.filter((entry) => entry.word === '猫')
  assert.equal(entries.length, 4)
  assert.equal(cats.length, 2)
  assert.deepEqual(cats[0].keys, ['猫', '貓'])
  assert.deepEqual(
    cats.map((entry) => entry.readings),
    [['mao1'], ['mao2']],
  )
  assert.match(cats[0].meanings[0].definitions[0].definition, /^cat/)
})

test('cantonese merges reading-only supplement with matching cedict definitions', async () => {
  const entries = await collect('yue', [
    fixture('yue.txt'),
    fixture('yue-readings.txt'),
    fixture('zh.txt'),
  ])
  const byWord = new Map(entries.map((entry) => [entry.word, entry]))
  assert.equal(entries.length, 6)
  assert.deepEqual(byWord.get('凄切').keys, ['凄切', '淒切'])
  assert.deepEqual(byWord.get('凄切').readings, ['cai1 cit3'])
  assert.equal(
    byWord.get('凄切').meanings[0].definitions[0].definition,
    'mournful',
  )
  assert.deepEqual(byWord.get('伊莉莎白').readings, ['ji1 lei6 saa1 baak6'])
  assert.equal(byWord.has('猫'), false)
  assert.deepEqual(byWord.get('陈慧琳').readings, ['can4 wai6 lam4'])
  assert.deepEqual(byWord.get('乒鈴𠾴唥').readings, [
    'ping1 ling1 baang4 laang4',
  ])
  assert.equal(
    byWord.get('丁').meanings[0].definitions.at(-1).definition,
    'a surname',
  )
})

test('cantonese matches normalized pinyin spacing but keeps heteronyms apart', async (t) => {
  const readings = await temporary(
    t,
    '行 行 [xing2] {hang4}\n行 行 [hang2] {hong4}\n',
    'readings',
  )
  const definitions = await temporary(
    t,
    '行 行 [x ing2] /to walk/\n行 行 [hang2] /row/\n行 行 [Hang2] /surname/\n',
    'definitions',
  )
  const entries = await collect('yue', [readings, definitions])
  assert.deepEqual(
    entries.map((entry) => entry.readings),
    [['hang4'], ['hong4']],
  )
  assert.deepEqual(
    entries.map((entry) => entry.meanings[0].definitions[0].definition),
    ['to walk', 'row'],
  )
})

test('japanese preserves kanji/kana aliases and inherited English sense parts of speech', async () => {
  const entries = await collect('ja', [fixture('ja.xml')])
  const eat = entries.find((entry) => entry.word === '食べる')
  const cat = entries.find((entry) => entry.word === '猫')
  assert.equal(entries.length, 2)
  assert.deepEqual(eat.keys, ['食べる', '喰べる', 'たべる'])
  assert.deepEqual(cat.keys, ['猫', 'ねこ', 'ネコ'])
  assert.deepEqual(cat.readings, ['ねこ', 'ネコ'])
  assert.equal(eat.meanings[0].partOfSpeech, 'Ichidan verb, transitive verb')
  assert.equal(eat.meanings[1].partOfSpeech, eat.meanings[0].partOfSpeech)
  assert.equal(eat.meanings[0].definitions[0].definition, 'to eat')
})

test('japanese filters foreign glosses and uses kana headwords without kanji', async (t) => {
  const path = await temporary(
    t,
    '<JMdict><entry><r_ele><reb>ねこ</reb></r_ele><sense><gloss xml:lang="eng">cat &amp; feline</gloss><gloss xml:lang="ger">Katze</gloss></sense></entry></JMdict>',
  )
  const [entry] = await collect('ja', [path])
  assert.deepEqual(entry.keys, ['ねこ'])
  assert.deepEqual(entry.meanings[0].definitions, [
    { definition: 'cat & feline' },
  ])
})

test('tagalog uses real sense synonyms, examples and lowercase aliases', async () => {
  const entries = await collect('tl', [fixture('tl.jsonl')])
  const father = entries.find((entry) => entry.word === 'A')
  const may = entries.find((entry) => entry.word === 'may')
  assert.deepEqual(father.keys, ['A', 'a'])
  assert.deepEqual(father.synonyms, ['Pan', 'An'])
  assert.deepEqual(father.meanings[0].synonyms, ['Pan', 'An'])
  assert.equal(father.meanings[0].definitions[0].definition, 'father of')
  assert.equal(father.meanings[0].definitions[0].example, 'A Miguel')
  assert.ok(may.synonyms.includes('mayroon'))
  assert.ok(may.synonyms.includes('meron'))
  assert.deepEqual(may.antonyms, ['wala'])
})

test('french preserves authentic sense synonyms, accented antonyms, examples and case aliases', async () => {
  const entries = await collect('fr', [fixture('fr.jsonl')])
  const professor = entries.find((entry) => entry.word === 'Pr')
  const follow = entries.find((entry) => entry.word === 'follow')
  assert.equal(entries.length, 2)
  assert.deepEqual(professor.keys, ['Pr', 'pr'])
  assert.deepEqual(professor.synonyms, ['Pʳ'])
  assert.equal(
    professor.meanings[0].definitions[0].definition,
    'abbreviation of professeur',
  )
  assert.deepEqual(follow.synonyms, ['follower', 'suivre', 's’abonner'])
  assert.deepEqual(follow.antonyms, ['défollow', 'défollower', 'se désabonner'])
  assert.equal(
    follow.meanings[0].definitions[0].example,
    'Venez me donner de la force et me follow pour suivre la campagne !',
  )
})

test('french retains accent marks in lowercase aliases and excludes tagalog records', async (t) => {
  const path = await temporary(
    t,
    [
      { word: 'École', lang_code: 'fr', senses: [{ glosses: ['school'] }] },
      { word: 'paaralan', lang_code: 'tl', senses: [{ glosses: ['school'] }] },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  )
  const entries = await collect('fr', [path])
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].keys, ['École', 'école'])
})

test('tagalog collects entry and sense synonyms/antonyms, skips empty and foreign senses', async (t) => {
  const path = await temporary(
    t,
    [
      {
        word: 'Ligaya',
        lang_code: 'tl',
        pos: 'noun',
        synonyms: [{ word: 'galak' }],
        antonyms: [{ word: 'lungkot' }],
        senses: [
          {
            glosses: ['joy'],
            synonyms: [{ word: 'saya' }],
            antonyms: [{ word: 'lumbay' }],
          },
        ],
      },
      { word: 'empty', senses: [{ glosses: [] }] },
      { word: 'foreign', lang_code: 'en', senses: [{ glosses: ['foreign'] }] },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  )
  const [entry] = await collect('tl', [path])
  assert.deepEqual(entry.keys, ['Ligaya', 'ligaya'])
  assert.deepEqual(entry.synonyms, ['saya', 'galak'])
  assert.deepEqual(entry.antonyms, ['lungkot', 'lumbay'])
})

for (const [id, name] of [
  ['en', 'en.xml'],
  ['zh', 'zh.txt'],
  ['yue', 'yue.txt'],
  ['ja', 'ja.xml'],
  ['tl', 'tl.jsonl'],
  ['fr', 'fr.jsonl'],
]) {
  test(`${id} detects gzip by magic in an opaque downloaded filename`, async (t) => {
    const input = await readFile(fixture(name))
    const path = await temporary(t, gzipSync(input))
    assert.deepEqual(
      await collect(id, [path]),
      await collect(id, [fixture(name)]),
    )
  })

  test(`${id} rejects truncated gzip and empty dictionaries`, async (t) => {
    const gzip = gzipSync(await readFile(fixture(name)))
    const damaged = await temporary(
      t,
      gzip.subarray(0, gzip.length - 6),
      'damaged',
    )
    await assert.rejects(collect(id, [damaged]))
    const empty = await temporary(
      t,
      id === 'en'
        ? '<LexicalResource></LexicalResource>'
        : id === 'ja'
          ? '<JMdict></JMdict>'
          : '',
      'empty',
    )
    await assert.rejects(collect(id, [empty]), /no entries/)
  })

  test(`${id} rejects oversized decompressed records`, async (t) => {
    const oversized = await temporary(
      t,
      gzipSync('x'.repeat(2 * 1024 * 1024 + 1)),
    )
    await assert.rejects(collect(id, [oversized]), /size limit/)
  })
}

test('cantonese accepts opaque official-style stored/deflated ZIP members', async (t) => {
  const content = await readFile(fixture('yue.txt'))
  for (const deflate of [false, true]) {
    const path = await temporary(
      t,
      zipFiles([{ name: 'cccanto-webdist.txt', content, deflate }]),
    )
    assert.deepEqual(
      await collect('yue', [path]),
      await collect('yue', [fixture('yue.txt')]),
    )
  }
})

test('cantonese rejects damaged, truncated, oversized and multi-member ZIPs', async (t) => {
  const content = await readFile(fixture('yue.txt'))
  const valid = zipFiles([{ name: 'canto.txt', content }])
  for (const data of [
    valid.subarray(0, valid.length - 1),
    zipFiles([{ name: 'canto.txt', content, crc: 0 }]),
    zipFiles([
      { name: 'canto.txt', content, declaredSize: 64 * 1024 * 1024 + 1 },
    ]),
    zipFiles([
      { name: 'canto.txt', content },
      { name: 'other.txt', content },
    ]),
    zipFiles([{ name: 'canto.xml', content }]),
  ]) {
    const path = await temporary(t, data)
    await assert.rejects(collect('yue', [path]))
  }
})

test('xml rejects mismatched tags, trailing data, unclosed roots and broken entities', async (t) => {
  const xml = await readFile(fixture('ja.xml'), 'utf8')
  for (const text of [
    xml.replace('</entry>', '</sense>'),
    xml.replace('</JMdict>', ''),
    `${xml}unexpected tail`,
    xml.replace('<gloss>to eat</gloss>', '<gloss>&unknown;</gloss>'),
    xml.replace('<gloss>to eat</gloss>', '<gloss>fish & chips</gloss>'),
  ]) {
    const path = await temporary(t, text)
    await assert.rejects(collect('ja', [path]))
  }
})

test('xml ignores external dtd locations and rejects external/recursive entity declarations', async (t) => {
  const xml = await readFile(fixture('en.xml'), 'utf8')
  const harmless = await temporary(
    t,
    xml.replace(
      '<LexicalResource',
      '<!DOCTYPE LexicalResource SYSTEM "file:///missing-secret">\n<LexicalResource',
    ),
  )
  assert.deepEqual(
    await collect('en', [harmless]),
    await collect('en', [fixture('en.xml')]),
  )
  for (const declaration of [
    '<!ENTITY secret SYSTEM "file:///missing-secret">',
    '<!ENTITY secret PUBLIC "secret" "https://invalid.invalid/secret">',
    '<!ENTITY % secret SYSTEM "https://invalid.invalid/secret">',
    '<!ENTITY one "literal"><!ENTITY two "&one;&one;">',
  ]) {
    const path = await temporary(
      t,
      `<!DOCTYPE JMdict [${declaration}]><JMdict></JMdict>`,
    )
    await assert.rejects(collect('ja', [path]), /entit/)
  }
})

test('xml rejects excessive nesting and dangling WordNet references', async (t) => {
  const deep = await temporary(
    t,
    `<JMdict>${'<entry>'.repeat(65)}${'</entry>'.repeat(65)}</JMdict>`,
  )
  await assert.rejects(collect('ja', [deep]), /depth limit/)
  const xml = await readFile(fixture('en.xml'), 'utf8')
  const dangling = await temporary(
    t,
    xml.replace(/synset="[^"]+"/, 'synset="missing"'),
  )
  await assert.rejects(collect('en', [dangling]), /missing WordNet synset/)
})

test('line formats reject malformed/truncated tails after valid entries', async (t) => {
  for (const [id, name, tail] of [
    ['zh', 'zh.txt', '貓 猫 [mao1] /unfinished'],
    ['zh', 'zh.txt', '貓 猫 [mao1]'],
    ['yue', 'yue.txt', 'cat missing brackets'],
    ['tl', 'tl.jsonl', '{"word":"cut"'],
    ['tl', 'tl.jsonl', '{"word":"cut","senses":{}}'],
    ['fr', 'fr.jsonl', '{"word":"couper"'],
  ]) {
    const path = await temporary(
      t,
      `${await readFile(fixture(name), 'utf8')}\n${tail}`,
    )
    await assert.rejects(collect(id, [path]))
  }
})

test('line reader bounds record count even for empty lines', async (t) => {
  const path = await temporary(t, gzipSync(`${'\n'.repeat(3_000_000)}#`))
  await assert.rejects(collect('zh', [path]), /record count limit/)
})

test('xml bounds whole records made of many small tokens', async (t) => {
  const path = await temporary(
    t,
    `<JMdict><entry><r_ele><reb>ねこ</reb></r_ele><sense>${'<gloss>cat</gloss>'.repeat(140_000)}</sense></entry></JMdict>`,
  )
  await assert.rejects(collect('ja', [path]), /record size limit/)
})

test('utf8 and xml tokens survive source chunk boundaries', async (t) => {
  const source = await readFile(fixture('ja.xml'), 'utf8')
  const path = await temporary(
    t,
    `<!--${'x'.repeat(65522)}-->\n${source.replace(/<\?xml[^?]+\?>/, '')}`,
  )
  assert.deepEqual(
    await collect('ja', [path]),
    await collect('ja', [fixture('ja.xml')]),
  )
  const cedict = await temporary(
    t,
    `#${'x'.repeat(65532)}\n貓 猫 [mao1] /cat/\n`,
  )
  const [entry] = await collect('zh', [cedict])
  assert.deepEqual(entry.keys, ['猫', '貓'])
})

test('converter rejects missing paths and source read failures', async () => {
  await assert.rejects(collect('en', []), /source paths/)
  await assert.rejects(
    collect('en', ['/nonexistent/hibi-dictionary-source']),
    /ENOENT/,
  )
})
