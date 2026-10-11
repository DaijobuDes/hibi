import assert from 'node:assert/strict'
import test from 'node:test'
import { createPersonalModel } from '../src/addons/autocomplete/model.ts'
import {
  autocompleteCompletions,
  prefixAt,
  rankWords,
} from '../src/addons/autocomplete/suggestions.ts'
import { createDictionaryApi } from '../src/addons/dictionary/api.ts'
import {
  datamuseProvider,
  wiktionaryProvider,
} from '../src/addons/dictionary/online.ts'
import { createRegistry } from '../src/addons/dictionary/providers.ts'
import { CompletionBroker } from '../src/renderer/src/completion-broker.ts'

const settings = {
  languages: ['en', 'tl', 'fr'],
  suggest: true,
  tabAccepts: true,
  learning: true,
  excludedDocuments: [],
  excludedWorkspaces: [],
}
const session = { scope: null, documentId: 'document', personal: true }
function dictionaryCompletions(registry, preferences, languageName) {
  const model = createPersonalModel()
  return autocompleteCompletions(
    createDictionaryApi(
      registry,
      () => settings.languages,
      () => [],
    ),
    preferences,
    { suggest: model.suggest, epoch: () => 0 },
    () => session,
    languageName,
  )
}
const request = (before, after = '') => ({
  view: {
    documentId: 'document',
    documentGeneration: 1,
    viewId: 'view',
    viewGeneration: 1,
  },
  contentVersion: 1,
  editor: 'source',
  documentLength: before.length + after.length,
  selection: { anchor: before.length, head: before.length },
  before,
  after,
  prose: { before, after },
  trigger: { kind: 'input', character: before.at(-1) },
})
const signal = () => new AbortController().signal
/** Collects broker updates and resolves when the final one arrives. */
const collect = () => {
  const updates = []
  let finish
  const done = new Promise((resolve) => {
    finish = resolve
  })
  return {
    updates,
    done,
    push(update) {
      updates.push(update)
      if (update.done) finish(update)
    },
  }
}

function registry(packs, calls = []) {
  const registry = createRegistry()
  const offline = async () => {
    throw new Error('network stubbed')
  }
  registry.register(wiktionaryProvider(offline))
  registry.register(datamuseProvider(offline))
  for (const [lang, words] of Object.entries(packs))
    registry.register({
      id: `offline-${lang}`,
      label: lang,
      kind: 'offline',
      languages: [lang],
      installed: () => true,
      lookup: async () => [],
      async complete(prefix, _lang, signal, limit) {
        calls.push({ lang, prefix, limit })
        signal.throwIfAborted()
        return words.filter((word) =>
          word.toLowerCase().startsWith(prefix.toLowerCase()),
        )
      },
    })
  return registry
}

test('suggestions take the Latin word being typed at the caret', () => {
  assert.equal(prefixAt('I am hap', ''), 'hap')
  assert.equal(prefixAt('I am hap', ' today'), 'hap')
  assert.equal(prefixAt('(l’éco', ''), 'l’éco')
  assert.equal(prefixAt('I am ha', ''), null)
  assert.equal(prefixAt('I am hap', 'py'), null)
  assert.equal(prefixAt('猫が好きで', ''), null)
  assert.equal(prefixAt('#tag', ''), 'tag')
})

test('suggestions rank preferred language, single words, case, and length', () => {
  const ranked = rankWords('hap', [
    {
      lang: 'en',
      words: ['hap', 'happy hour', 'Hapsburg', 'happiness', 'happy', 'haply'],
    },
    { lang: 'fr', words: ['hapax', 'happy'] },
  ])
  assert.deepEqual(
    ranked.map(({ word, lang }) => `${lang}:${word}`),
    [
      'en:haply',
      'en:happy',
      'en:happiness',
      'en:Hapsburg',
      'en:happy hour',
      'fr:hapax',
    ],
  )
  assert.equal(
    rankWords('Hap', [{ lang: 'en', words: ['Hapsburg', 'happiness'] }])[0]
      .word,
    'Hapsburg',
  )
  assert.equal(
    rankWords('a', [
      { lang: 'en', words: Array.from({ length: 40 }, (_, i) => `a${i}`) },
    ]).length,
    8,
  )
})

test('suggestions come only from installed packs, keep case, and never go online', async () => {
  const calls = []
  const provider = dictionaryCompletions(
    registry({ en: ['happy', 'happen'], fr: ['hapax'] }, calls),
    () => settings,
    (lang) => lang,
  )
  const items = await provider(request('Hap'), signal())
  assert.deepEqual(
    items.map(({ label, insertText, from, to, detail }) => [
      label,
      insertText,
      from,
      to,
      detail,
    ]),
    [
      ['happy', 'Happy', 0, 3, 'en'],
      ['happen', 'Happen', 0, 3, 'en'],
      ['hapax', 'Hapax', 0, 3, 'fr'],
    ],
  )
  assert.deepEqual(calls.map(({ lang }) => lang).sort(), ['en', 'fr'])
  assert.ok(items.every((item) => item.acceptOnTab === undefined))
  const keepTabSettings = { ...settings, tabAccepts: false }
  const keepTab = dictionaryCompletions(
    registry({ en: ['happy'] }),
    () => keepTabSettings,
    (lang) => lang,
  )
  assert.equal((await keepTab(request('hap'), signal()))[0].acceptOnTab, false)
  assert.deepEqual(await provider(request('ha'), signal()), [])
  assert.deepEqual(
    await provider(
      { ...request('hap'), selection: { anchor: 0, head: 3 } },
      signal(),
    ),
    [],
  )
})

test('suggestions stop when a newer keystroke cancels the request', async () => {
  const calls = []
  const provider = dictionaryCompletions(
    registry({ en: ['happy'], fr: ['hapax'] }, calls),
    () => settings,
    (lang) => lang,
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(provider(request('hap'), controller.signal), {
    name: 'AbortError',
  })
  assert.deepEqual(calls, [])

  const broker = new CompletionBroker()
  broker.register({ addonId: 'dictionary', activationGeneration: 1 }, provider)
  const first = collect()
  let current = request('hap')
  broker.request(
    () => current,
    () => current,
    (update) => first.push(update),
  )
  current = request('happ')
  const second = collect()
  broker.request(
    () => current,
    () => current,
    (update) => second.push(update),
  )
  assert.deepEqual(first.updates, [])
  assert.deepEqual(
    (await second.done).items.map((item) => item.label),
    ['happy'],
  )
  broker.dispose()
})

test('the completion broker keeps a provider’s Tab preference per item', async () => {
  const broker = new CompletionBroker()
  broker.register({ addonId: 'one', activationGeneration: 1 }, () => [
    { label: 'a', insertText: 'a', from: 0, to: 3, acceptOnTab: false },
    { label: 'b', insertText: 'b', from: 0, to: 3 },
    { label: 'c', insertText: 'c', from: 0, to: 3, acceptOnTab: 'no' },
  ])
  const current = request('hap')
  const updates = collect()
  broker.request(
    () => current,
    () => current,
    (update) => updates.push(update),
  )
  assert.deepEqual(
    (await updates.done).items.map((item) => [item.label, item.acceptOnTab]),
    [
      ['a', false],
      ['b', undefined],
    ],
  )
  broker.dispose()
})

test('ranking a full set of pack matches stays well under the typing budget', () => {
  const words = Array.from(
    { length: 32 },
    (_, i) => `prefix${'x'.repeat(i % 7)}${i}`,
  )
  const found = ['en', 'tl', 'fr'].map((lang) => ({ lang, words }))
  const start = performance.now()
  for (let i = 0; i < 200; i++) rankWords('pre', found)
  assert.ok((performance.now() - start) / 200 < 1)
})
