import assert from 'node:assert/strict'
import test from 'node:test'
import { createOfflineProviders } from '../src/addons/dictionary/offline.ts'
import { packIds } from '../src/addons/dictionary/packs.ts'
import { createRegistry, gather } from '../src/addons/dictionary/providers.ts'
import {
  readPreferences,
  readRecentPack,
  writePreferences,
} from '../src/addons/dictionary/settings.ts'

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
      return method === 'packInstalled' ? input === 'zh' && installed : [entry]
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

test('completion bounds language and cancellation before and after native query', async () => {
  const calls = []
  let release
  const provider = createOfflineProviders({
    query(method, input) {
      calls.push({ method, input })
      return new Promise((resolve) => {
        release = resolve
      })
    },
  })[0]
  const signal = new AbortController().signal
  assert.deepEqual(await provider.complete('ch', 'fr', signal), [])
  assert.deepEqual(await provider.complete(' ', 'en', signal), [])
  await assert.rejects(provider.complete('ch', 'en', AbortSignal.abort()))
  assert.equal(calls.length, 0)
  const controller = new AbortController()
  const pending = provider.complete('ch', 'en', controller.signal)
  assert.deepEqual(calls[0], {
    method: 'packComplete',
    input: { id: 'en', prefix: 'ch', limit: 8 },
  })
  const reason = new Error('cancel completion')
  controller.abort(reason)
  await assert.rejects(pending, (error) => error === reason)
  release(['child'])
  const result = provider.complete('ch', 'en', signal, 32)
  release(['child', 'children'])
  assert.deepEqual(await result, ['child', 'children'])
  assert.equal(calls[1].input.limit, 32)
})

test('lookup and related reject cancellation while native response remains held', async () => {
  for (const method of ['lookup', 'related']) {
    let release
    const provider = createOfflineProviders({
      query() {
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })[0]
    const controller = new AbortController()
    const reason = new Error('cancel lookup')
    const pending = provider[method]('child', 'en', controller.signal)
    controller.abort(reason)
    await assert.rejects(pending, (error) => error === reason)
    release([entry])
  }
})

test('recent pack persists only successful lookup or completion language beside preferences', async (t) => {
  const saved = new Map()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  })
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  })
  assert.deepEqual(readPreferences(), { latin: 'en', han: 'zh' })
  assert.equal(readRecentPack(), undefined)
  saved.set('hibi:dictionary:recent-pack', '../en')
  assert.equal(readRecentPack(), undefined)
  let result = [entry]
  const providers = createOfflineProviders({
    async query() {
      return result
    },
  })
  const zh = providers.find((provider) => provider.id === 'offline-zh')
  const fr = providers.find((provider) => provider.id === 'offline-fr')
  const signal = new AbortController().signal
  await zh.lookup('猫', 'zh', signal)
  assert.equal(readRecentPack(), 'zh')
  writePreferences({ latin: 'fr', han: 'ja' })
  assert.deepEqual(readPreferences(), { latin: 'fr', han: 'ja' })
  assert.equal(readRecentPack(), 'zh')
  result = []
  await fr.lookup('missing', 'fr', signal)
  await fr.complete('missing', 'fr', signal)
  assert.equal(readRecentPack(), 'zh')
  result = ['Maison']
  await fr.complete('mai', 'fr', signal)
  assert.equal(readRecentPack(), 'fr')
  await assert.rejects(zh.lookup('猫', 'zh', AbortSignal.abort()))
  assert.equal(readRecentPack(), 'fr')
  assert.deepEqual([...saved.keys()].sort(), [
    'hibi:dictionary',
    'hibi:dictionary:recent-pack',
  ])
  assert.equal(saved.get('hibi:dictionary:recent-pack'), 'fr')
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
    async query(method, input) {
      return method === 'packInstalled' ? input === 'zh' : [entry]
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
  const de = providers.find((p) => p.languages[0] === 'de')
  const [german] = await de.lookup('follow', 'de', signal)
  assert.equal(
    german.source.url,
    'https://en.wiktionary.org/wiki/follow#German',
  )
  assert.deepEqual((await de.related('follow', 'de', signal)).synonyms, [
    'abonné',
  ])
})
