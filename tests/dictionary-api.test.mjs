import assert from 'node:assert/strict'
import test from 'node:test'
import { createDictionaryApi } from '../src/addons/dictionary/api.ts'
import { createRegistry } from '../src/addons/dictionary/providers.ts'

test('exported vocabulary calls only installed offline completions', async () => {
  const registry = createRegistry()
  const calls = []
  const network = () => {
    assert.fail('vocabulary must never request network access')
  }
  registry.register({
    id: 'online',
    label: 'online',
    kind: 'online',
    languages: ['en', 'fr'],
    lookup: network,
    complete: network,
  })
  registry.register({
    id: 'offline-en',
    label: 'English',
    kind: 'offline',
    languages: ['en'],
    installed: () => true,
    lookup: network,
    complete: async (prefix, lang, _signal, limit) => {
      calls.push({ prefix, lang, limit })
      return ['happy']
    },
  })
  registry.register({
    id: 'offline-fr',
    label: 'French',
    kind: 'offline',
    languages: ['fr'],
    installed: () => false,
    lookup: network,
    complete: network,
  })
  const api = createDictionaryApi(
    registry,
    () => ['en', 'fr'],
    () => [],
  )
  assert.equal(api.version, 1)
  assert.deepEqual(await api.complete('hap', api.suggestionLanguages(), 24), [
    { lang: 'en', words: ['happy'] },
    { lang: 'fr', words: [] },
  ])
  assert.deepEqual(calls, [{ prefix: 'hap', lang: 'en', limit: 24 }])
  assert.deepEqual(await api.complete('', ['en'], 24), [])
  assert.deepEqual(await api.complete('hap', ['en'], NaN), [])
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(api.complete('hap', ['en'], 24, controller.signal), {
    name: 'AbortError',
  })
  assert.equal(calls.length, 1)
})
