import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCustomWord,
  customWords,
  customWordsProvider,
  editCustomWord,
  exportCustomWords,
  importCustomWords,
  listCustomWords,
  mergeCustomWords,
  onCustomWordsChanged,
  openCustomWords,
  updateCustomWords,
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
  // Words starting with `#` are not read back as comments.
  const tags = [{ word: '#hashtag', lang: 'en' }, { word: '\\#odd' }, { word: 'C#' }]
  const tagText = exportCustomWords(tags)
  assert.equal(tagText, '\\#hashtag\ten\n\\\\#odd\nC#')
  assert.deepEqual(importCustomWords(tagText), tags)
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
  // Queued changes each see the list the previous one saved.
  await Promise.all([
    updateCustomWords((current) => current.slice(1)),
    addCustomWord({ word: 'kilig', note: 'giddy' }),
    updateCustomWords((current) => current.filter((item) => !item.lang)),
  ])
  assert.deepEqual(listCustomWords(), [
    { word: 'Hibi', note: 'an editor' },
    { word: 'kilig', note: 'giddy' },
  ])
  await updateCustomWords((current) => current.slice(0, 1))
  assert.deepEqual(listCustomWords(), [{ word: 'Hibi', note: 'an editor' }])
  handle.external([{ word: 'gigil' }])
  assert.deepEqual(listCustomWords(), [{ word: 'gigil' }])
  assert.ok(Object.isFrozen(listCustomWords()))
  close()
  assert.deepEqual(listCustomWords(), [])
  assert.ok(changes >= 5)
  stopListening()
})

test('queued field edits apply to the word as it is saved', async () => {
  const { context } = storage([{ word: 'kilig', note: 'old' }])
  const close = await openCustomWords(context)
  const [item] = listCustomWords()
  // A note blur, then a language change before the note is saved.
  await Promise.all([
    editCustomWord(item, ({ note: _old, ...rest }) => ({ ...rest, note: 'new' })),
    editCustomWord(item, (current) => ({ ...current, lang: 'tl' })),
  ])
  assert.deepEqual(listCustomWords(), [
    { word: 'kilig', note: 'new', lang: 'tl' },
  ])
  close()
})

test('custom words refuse to go over capacity without saving part of a change', async () => {
  const full = Array.from({ length: 4999 }, (_, index) => ({ word: `w${index}` }))
  const { handle, context } = storage(full)
  const close = await openCustomWords(context)
  await assert.rejects(
    updateCustomWords((current) =>
      mergeCustomWords(current, importCustomWords('kilig\ngigil')),
    ),
    /up to 5,000 custom words/,
  )
  assert.equal(listCustomWords().length, 4999)
  await addCustomWord({ word: 'kilig' })
  await assert.rejects(addCustomWord({ word: 'gigil' }), /up to 5,000/)
  assert.equal(handle.snapshot().value.length, 5000)
  // Editing a word already listed still saves at capacity.
  await addCustomWord({ word: 'kilig', note: 'giddy' })
  assert.equal(listCustomWords().at(-1).note, 'giddy')
  assert.equal(importCustomWords(full.map(({ word }) => word).join('\n') + '\nx').length, 5000)
  close()
})

test('custom words keep a newer revision over a late save reply or notification', async () => {
  // A held save reply, as the storage handle delivers it: its snapshot keeps
  // the newer revision that arrived first.
  let current = { status: 'ready', revision: 1, value: [{ word: 'kilig' }] }
  let reply
  const listeners = new Set()
  const notify = (next) => {
    current = next
    for (const listener of listeners) listener()
  }
  const handle = {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (value) =>
      new Promise((resolve) => {
        reply = () => resolve({ status: 'saved', revision: 2, value })
      }),
  }
  const close = await openCustomWords({
    storage: { global: async () => handle },
  })
  const saving = addCustomWord({ word: 'gigil' })
  await new Promise((resolve) => setImmediate(resolve))
  const newer = [{ word: 'kilig' }, { word: 'gigil' }, { word: 'Hibi' }]
  notify({ status: 'ready', revision: 3, value: newer })
  reply()
  await saving
  assert.deepEqual(listCustomWords(), newer)
  // A notification for an older revision arriving late is ignored too.
  notify({ status: 'ready', revision: 2, value: [{ word: 'kilig' }] })
  assert.deepEqual(listCustomWords(), newer)
  close()
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
