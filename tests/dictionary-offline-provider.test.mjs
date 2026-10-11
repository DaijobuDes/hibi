import assert from 'node:assert/strict'
import test from 'node:test'
import { createOfflineProviders } from '../src/addons/dictionary/offline.ts'
import { packIds } from '../src/addons/dictionary/packs.ts'
import { createRegistry, gather } from '../src/addons/dictionary/providers.ts'

const entry = {
  word: '猫',
  keys: ['猫', '貓'],
  readings: ['mao1'],
  meanings: [
    { partOfSpeech: '', definitions: [{ definition: 'cat' }], synonyms: [] },
  ],
  synonyms: [],
  antonyms: [],
}

test('offline providers follow installation changes and retain readings, glosses and attribution', async () => {
  let installed = true
  const calls = []
  const native = {
    async query(method, input) {
      calls.push({ method, input })
      return method === 'packs'
        ? [{ id: 'zh', manifest: installed ? {} : null }]
        : [entry]
    },
  }
  const providers = createOfflineProviders(native)
  assert.deepEqual(
    providers.flatMap((p) => p.languages),
    packIds,
  )
  const zh = providers.find((p) => p.languages[0] === 'zh')
  assert.equal(await zh.installed(), true)
  const [value] = await zh.lookup('貓', 'zh', new AbortController().signal)
  assert.equal(value.term, '猫')
  assert.equal(value.reading, 'mao1')
  assert.deepEqual(value.senses, [{ gloss: 'cat' }])
  assert.equal(value.source.name, 'CC-CEDICT')
  assert.equal(value.source.license, 'CC BY-SA 4.0')
  installed = false
  assert.equal(await zh.installed(), false)
  assert.equal(await zh.related('猫', 'zh', new AbortController().signal), null)
  const count = calls.length
  await assert.rejects(zh.lookup('猫', 'zh', AbortSignal.abort()))
  assert.equal(calls.length, count)
})

test('a local answer across candidate languages avoids all online requests', async () => {
  const registry = createRegistry()
  let requests = 0
  registry.register({
    id: 'online',
    label: 'online',
    kind: 'online',
    languages: ['zh', 'yue', 'ja'],
    async lookup() {
      requests++
      return []
    },
  })
  for (const provider of createOfflineProviders({
    async query(method) {
      return method === 'packs' ? [{ id: 'zh', manifest: {} }] : [entry]
    },
  }))
    registry.register(provider)
  const result = await gather(
    registry,
    ['zh', 'yue', 'ja'],
    'lookup',
    (provider, lang) =>
      provider.lookup('猫', lang, new AbortController().signal),
  )
  assert.equal(result.found[0].lang, 'zh')
  assert.equal(requests, 0)
})

test('related words preserve source relations and Wiktionary entries link to contributor pages', async () => {
  const providers = createOfflineProviders({
    async query() {
      return [
        {
          ...entry,
          word: 'follow',
          synonyms: ['follow', 'abonné'],
          antonyms: ['unfollow'],
        },
      ]
    },
  })
  const fr = providers.find((p) => p.languages[0] === 'fr')
  const signal = new AbortController().signal
  const related = await fr.related('follow', 'fr', signal)
  assert.deepEqual(related.synonyms, ['abonné'])
  assert.deepEqual(related.antonyms, ['unfollow'])
  const [value] = await fr.lookup('follow', 'fr', signal)
  assert.equal(value.source.url, 'https://en.wiktionary.org/wiki/follow#French')
})
