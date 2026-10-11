import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createLookups,
  matchCase,
  parseDefinitions,
  parseWords,
  wordAt,
} from '../src/addons/dictionary/lookup.ts'

const fixture = (name) =>
  readFile(new URL(`./fixtures/dictionary/${name}`, import.meta.url), 'utf8')

test('dictionary parses captured Free Dictionary API and Datamuse responses', async () => {
  const definitions = parseDefinitions(
    await fixture('dictionaryapi-happy.json'),
  )
  assert.deepEqual(
    definitions.meanings.map((meaning) => meaning.partOfSpeech),
    ['noun', 'verb', 'adjective'],
  )
  assert.equal(definitions.meanings[0].definitions.length, 2)
  assert.deepEqual(definitions.meanings[2].definitions[0], {
    definition:
      'Having a feeling arising from a consciousness of well-being or of enjoyment; enjoying good of any kind, such as comfort, peace, or tranquillity; blissful, contented, joyous.',
    example: 'Music makes me feel happy.',
  })
  assert.equal(definitions.meanings[1].definitions[0].example, undefined)
  assert.deepEqual(definitions.meanings[1].synonyms, ['happify'])
  assert.equal(definitions.meanings[2].synonyms.length, 12)
  assert.equal(definitions.license, 'CC BY-SA 3.0')
  assert.equal(parseDefinitions('[]'), null)
  assert.throws(() => parseDefinitions('{"title":"No Definitions Found"}'))

  const synonyms = parseWords(
    await fixture('datamuse-synonyms-happy.json'),
    'happy',
  )
  assert.deepEqual(synonyms.slice(0, 3), ['halcyon', 'content', 'bright'])
  assert.deepEqual(
    parseWords(await fixture('datamuse-antonyms-happy.json'), 'happy'),
    ['sad', 'distressed', 'unhappy', 'dysphoric'],
  )
  assert.deepEqual(
    parseWords('[{"word":"Happy"},{"word":7},{"word":"glad"}]', 'happy'),
    ['glad'],
  )
})

test('dictionary finds the word at the caret or in a selection', () => {
  const text = 'A “don’t-stop” day, well-being.'
  assert.deepEqual(wordAt(text, 5, 5), { from: 3, to: 13, word: 'don’t-stop' })
  assert.deepEqual(wordAt(text, 18, 18), { from: 15, to: 18, word: 'day' })
  assert.deepEqual(wordAt(text, 14, 19).word, 'day')
  assert.equal(wordAt(text, 15, 25), null)
  assert.equal(wordAt('   ', 1, 1), null)
  assert.equal(wordAt('x'.repeat(65), 0, 0), null)
})

test('dictionary replacements keep the first letter case', () => {
  assert.equal(matchCase('happy', 'glad'), 'glad')
  assert.equal(matchCase('Happy', 'glad'), 'Glad')
  assert.equal(matchCase('Élan', 'flair'), 'Flair')
  assert.equal(matchCase('happy', 'English'), 'English')
})

test('dictionary maps host failures, caches answers, and retries failures', async () => {
  const requests = []
  const responses = []
  const lookups = createLookups(async (request) => {
    requests.push(request.url)
    return responses.shift()
  })
  responses.push({ ok: false, code: 'unavailable' })
  assert.deepEqual(await lookups.define('Happy'), {
    ok: false,
    reason: 'offline',
  })
  responses.push({
    ok: true,
    value: { text: await fixture('dictionaryapi-happy.json') },
  })
  assert.equal((await lookups.define('happy')).value.meanings.length, 3)
  assert.equal((await lookups.define('HAPPY')).ok, true)
  assert.deepEqual(requests, [
    'https://api.dictionaryapi.dev/api/v2/entries/en/happy',
    'https://api.dictionaryapi.dev/api/v2/entries/en/happy',
  ])

  responses.push({ ok: false, code: 'http-status', status: 404 })
  assert.deepEqual(await lookups.define('qwzx'), { ok: true, value: null })
  responses.push({ ok: false, code: 'http-status', status: 429 })
  assert.deepEqual(await lookups.thesaurus('glad'), {
    ok: false,
    reason: 'rate-limited',
  })
  responses.push({ ok: false, code: 'permission-denied' })
  assert.deepEqual(await lookups.thesaurus('glad'), {
    ok: false,
    reason: 'denied',
  })
  responses.push({ ok: true, value: { text: 'not json' } })
  assert.deepEqual(await lookups.define('broken'), {
    ok: false,
    reason: 'unavailable',
  })

  requests.length = 0
  responses.push(
    {
      ok: true,
      value: { text: await fixture('datamuse-synonyms-happy.json') },
    },
    {
      ok: true,
      value: { text: await fixture('datamuse-antonyms-happy.json') },
    },
  )
  const thesaurus = await lookups.thesaurus('happy')
  assert.equal(thesaurus.value.antonyms[0], 'sad')
  assert.deepEqual(await lookups.thesaurus('happy'), thesaurus)
  assert.deepEqual(requests, [
    'https://api.datamuse.com/words?rel_syn=happy&max=24',
    'https://api.datamuse.com/words?rel_ant=happy&max=24',
  ])
})
