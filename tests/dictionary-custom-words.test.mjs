import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCustomWord,
  customWords,
  customWordsProvider,
  exportCustomWords,
  importCustomWords,
  listCustomWords,
  mergeCustomWords,
  onCustomWordsChanged,
  openCustomWords,
  saveCustomWords,
} from '../src/addons/dictionary/custom-words.ts'
import {
  datamuseProvider,
  wiktionaryProvider,
} from '../src/addons/dictionary/online.ts'
import { createRegistry, gather } from '../src/addons/dictionary/providers.ts'
import { dictionaryCompletions } from '../src/addons/dictionary/suggestions.ts'

const signal = new AbortController().signal

/** In-memory global storage with the handle's compare-and-set contract. */
function storage(initial) {
  let current =
    initial === undefined
      ? { status: 'missing', revision: 0 }
      : { status: 'ready', revision: 1, value: initial }
  const listeners = new Set()
  const handle = {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set(value) {
      current = { status: 'ready', revision: current.revision + 1, value }
      return { status: 'saved', revision: current.revision, value }
    },
    /** Another window saves. */
    external(value) {
      current = { status: 'ready', revision: current.revision + 1, value }
      for (const listener of listeners) listener()
    },
  }
  return { handle, context: { storage: { global: async () => handle } } }
}

test('custom words keep valid entries once per word and language', () => {
  assert.deepEqual(
    customWords([
      { word: '  Hibi ', note: ' an editor ' },
      { word: 'hibi' },
      { word: 'hibi', lang: 'ja' },
      { word: 'x\u0000y' },
      { word: 'a'.repeat(65) },
      { word: 'kilig', lang: 'xx', note: '' },
      'loose',
      null,
    ]),
    [
      { word: 'Hibi', note: 'an editor' },
      { word: 'hibi', lang: 'ja' },
      { word: 'kilig' },
    ],
  )
  assert.deepEqual(customWords({ word: 'one' }), [])
  assert.deepEqual(
    mergeCustomWords(
      [{ word: 'kilig' }, { word: 'Hibi' }],
      [{ word: 'hibi', note: 'renamed' }, { word: 'gigil' }],
    ),
    [{ word: 'kilig' }, { word: 'hibi', note: 'renamed' }, { word: 'gigil' }],
  )
})

test('custom words round-trip through plain text', () => {
  const words = [
    { word: 'kilig', lang: 'tl', note: 'giddy\nthrill' },
    { word: 'Hibi' },
    { word: 'gemütlich', lang: 'de' },
  ]
  const text = exportCustomWords(words)
  assert.equal(text, 'kilig\ttl\tgiddy thrill\nHibi\ngemütlich\tde')
  assert.deepEqual(importCustomWords(`# mine\n\n${text}\r\n`), [
    { word: 'kilig', lang: 'tl', note: 'giddy thrill' },
    { word: 'Hibi' },
    { word: 'gemütlich', lang: 'de' },
  ])
})

test('custom words load, save, follow other windows, and clear on stop', async () => {
  const { handle, context } = storage([{ word: 'kilig', lang: 'tl' }])
  let changes = 0
  const stopListening = onCustomWordsChanged(() => changes++)
  await assert.rejects(addCustomWord({ word: 'early' }), /Turn on/)
  const close = await openCustomWords(context)
  assert.deepEqual(listCustomWords(), [{ word: 'kilig', lang: 'tl' }])
  await addCustomWord({ word: 'Hibi', note: 'an editor' })
  await assert.rejects(addCustomWord({ word: '  ' }), /Enter a word/)
  assert.deepEqual(handle.snapshot().value, [
    { word: 'kilig', lang: 'tl' },
    { word: 'Hibi', note: 'an editor' },
  ])
  await saveCustomWords(listCustomWords().slice(1))
  assert.deepEqual(listCustomWords(), [{ word: 'Hibi', note: 'an editor' }])
  handle.external([{ word: 'gigil' }])
  assert.deepEqual(listCustomWords(), [{ word: 'gigil' }])
  assert.ok(Object.isFrozen(listCustomWords()))
  close()
  assert.deepEqual(listCustomWords(), [])
  assert.ok(changes >= 5)
  stopListening()
})

test('custom words are looked up as the user’s own without going online', async () => {
  const { context } = storage([
    { word: 'Hibi', note: 'a markdown editor' },
    { word: 'kilig', lang: 'tl' },
  ])
  const close = await openCustomWords(context)
  const sent = []
  const network = async ({ url }) => {
    sent.push(url)
    throw new Error('network stubbed')
  }
  const registry = createRegistry()
  registry.register(wiktionaryProvider(network))
  registry.register(datamuseProvider(network))
  registry.register(customWordsProvider(() => 'en'))
  const lookUp = (word, langs) =>
    gather(registry, langs, 'lookup', (provider, lang, cachedOnly) =>
      provider.lookup(word, lang, signal, cachedOnly),
    )
  const hibi = await lookUp('hibi', ['en', 'tl', 'fr', 'de'])
  assert.deepEqual(hibi.found, [
    {
      lang: 'en',
      value: [
        {
          term: 'Hibi',
          lang: 'en',
          senses: [{ gloss: 'a markdown editor' }],
          source: { name: 'Your word', license: '' },
        },
      ],
    },
  ])
  const kilig = await lookUp('Kilig', ['en', 'tl'])
  assert.equal(kilig.found[0].lang, 'tl')
  assert.equal(
    kilig.found[0].value[0].senses[0].gloss,
    'Added to your dictionary.',
  )
  assert.deepEqual(sent, [])
  close()
})

test('custom words come before pack words in suggestions', async () => {
  const provider = dictionaryCompletions(
    async () => [{ lang: 'en', words: ['happy', 'happen'] }],
    () => ({ suggest: true, tabAccepts: true, languages: ['en'] }),
    (lang) => lang,
    () => [
      { word: 'happenstance' },
      { word: 'hapag', lang: 'tl' },
      { word: 'Happy' },
      { word: 'hap' },
    ],
  )
  const items = await provider(
    {
      view: {
        documentId: 'document',
        documentGeneration: 1,
        viewId: 'view',
        viewGeneration: 1,
      },
      contentVersion: 1,
      editor: 'source',
      documentLength: 3,
      selection: { anchor: 3, head: 3 },
      before: 'hap',
      after: '',
      trigger: { kind: 'input', character: 'p' },
    },
    signal,
  )
  assert.deepEqual(
    items.map(({ label, detail }) => [label, detail]),
    [
      ['Happy', 'Your word'],
      ['happenstance', 'Your word'],
      ['happen', undefined],
    ],
  )
})
