import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  datamuseProvider,
  wiktionaryProvider,
} from '../src/addons/dictionary/online.ts'
import { createRegistry } from '../src/addons/dictionary/providers.ts'
import { lookUpSide, meaningGroups } from '../src/addons/dictionary/side.ts'

const signal = new AbortController().signal
const fixture = (name) =>
  readFile(new URL(`./fixtures/dictionary/${name}`, import.meta.url), 'utf8')

function online(getText) {
  const registry = createRegistry()
  registry.register(wiktionaryProvider(getText))
  registry.register(datamuseProvider(getText))
  return registry
}

test('side view lookups send nothing until online lookup is chosen, then reuse the session cache', async () => {
  const sent = []
  let allow = false
  const page = await fixture('wiktionary-happy.json')
  const registry = online(async ({ url }) => {
    if (!allow) throw new Error(`network stubbed: ${url}`)
    sent.push(url)
    return {
      ok: true,
      value: { text: url.includes('datamuse') ? '[{"word":"glad"}]' : page },
    }
  })
  const offline = await lookUpSide(registry, 'happy', ['en'], false, signal)
  assert.equal(offline.definitions.found.length, 0)
  assert.equal(offline.thesaurus.found.length, 0)
  assert.equal(offline.definitions.failure, undefined)
  assert.deepEqual(sent, [])

  allow = true
  const fetched = await lookUpSide(registry, 'happy', ['en'], true, signal)
  assert.equal(fetched.definitions.found[0].value[0].partOfSpeech, 'adjective')
  assert.deepEqual(fetched.thesaurus.found[0].value.synonyms, ['glad'])
  assert.equal(sent.length, 3)

  allow = false
  const cached = await lookUpSide(registry, 'Happy', ['en'], false, signal)
  assert.equal(cached.definitions.found[0].value[0].partOfSpeech, 'adjective')
  assert.deepEqual(cached.thesaurus.found[0].value.synonyms, ['glad'])
  assert.equal(sent.length, 3)
})

test('side view prefers installed packs and groups synonyms by meaning', async () => {
  const registry = online(async () => {
    throw new Error('network stubbed')
  })
  const source = { name: 'Pack', license: 'CC BY 4.0' }
  registry.register({
    id: 'offline-en',
    label: 'English',
    kind: 'offline',
    languages: ['en'],
    installed: () => true,
    lookup: async (term) => [
      {
        term,
        lang: 'en',
        partOfSpeech: 'adjective',
        senses: [{ gloss: 'feeling pleasure' }],
        synonyms: ['glad', 'happy', 'glad'],
        source,
      },
      {
        term,
        lang: 'en',
        partOfSpeech: 'adjective',
        senses: [{ gloss: 'fortunate' }],
        synonyms: [],
        source,
      },
    ],
    related: async () => ({ synonyms: ['glad'], antonyms: ['sad'], source }),
  })
  const result = await lookUpSide(registry, 'happy', ['en'], false, signal)
  assert.equal(result.thesaurus.found[0].value.antonyms[0], 'sad')
  assert.deepEqual(meaningGroups(result.definitions.found[0].value, 'Happy'), [
    { label: 'adjective · feeling pleasure', words: ['glad'] },
  ])
})
