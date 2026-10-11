import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  detectLangs,
  matchCase,
  plainText,
  wordAt,
} from '../src/addons/dictionary/lookup.ts'
import {
  datamuseProvider,
  parseWiktionary,
  parseWords,
  wiktionaryProvider,
} from '../src/addons/dictionary/online.ts'
import {
  createRegistry,
  DictionaryError,
  gather,
} from '../src/addons/dictionary/providers.ts'

const fixture = (name) =>
  readFile(new URL(`./fixtures/dictionary/${name}`, import.meta.url), 'utf8')
const preferences = { han: 'zh', latin: 'en' }
const signal = new AbortController().signal

test('dictionary parses captured Wiktionary and Datamuse responses', async () => {
  const happy = parseWiktionary(
    await fixture('wiktionary-happy.json'),
    'happy',
    'en',
  )
  assert.deepEqual(
    happy.map((entry) => entry.partOfSpeech),
    ['adjective', 'noun', 'verb'],
  )
  assert.equal(
    happy[0].senses[0].gloss,
    'Having a feeling arising from a consciousness of well-being or of enjoyment; enjoying good of any kind, such as comfort, peace, or tranquillity; blissful, contented, joyous.',
  )
  assert.equal(happy[0].senses[0].example, 'Music makes me feel happy.')
  assert.equal(happy[0].source.license, 'CC BY-SA 4.0')
  assert.equal(happy[0].source.url, 'https://en.wiktionary.org/wiki/happy')

  const chat = await fixture('wiktionary-chat.json')
  assert.equal(parseWiktionary(chat, 'chat', 'fr')[0].lang, 'fr')
  assert.equal(parseWiktionary(chat, 'chat', 'tl')[0].partOfSpeech, 'noun')
  assert.equal(
    parseWiktionary(
      await fixture('wiktionary-maganda.json'),
      'maganda',
      'tl',
    )[0].partOfSpeech,
    'adjective',
  )
  assert.equal(
    parseWiktionary(await fixture('wiktionary-nihao.json'), '你好', 'zh')[0]
      .senses[0].gloss,
    'hello; hi',
  )
  const neko = parseWiktionary(
    await fixture('wiktionary-neko.json'),
    '猫',
    'ja',
  )
  assert.equal(neko[0].lang, 'ja')
  assert.deepEqual(
    parseWiktionary(await fixture('wiktionary-neko.json'), '猫', 'zh'),
    [],
  )
  // Cantonese senses live in Wiktionary's Chinese section.
  const sikfaan = parseWiktionary(
    await fixture('wiktionary-sikfaan.json'),
    '食飯',
    'yue',
  )
  assert.equal(sikfaan[0].lang, 'zh')
  assert.equal(sikfaan[0].senses[0].gloss, 'to eat')
  assert.throws(() => parseWiktionary('[]', 'x', 'en'))

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
  assert.equal(
    plainText('<a href="/wiki/x">fish</a> &amp; <i>chips</i>&#33; &#x2014;'),
    'fish & chips! —',
  )
})

test('dictionary finds the caret word with the right segmenter and language', () => {
  const text = 'A “don’t” day, well-being.'
  assert.deepEqual(wordAt(text, 5, 5, preferences), {
    from: 3,
    to: 8,
    word: 'don’t',
  })
  assert.deepEqual(wordAt(text, 13, 13, preferences).word, 'day')
  assert.equal(wordAt(text, 10, 15, preferences).word, 'day,')
  assert.equal(wordAt('   ', 1, 1, preferences), null)
  assert.equal(wordAt('a\nb', 0, 3, preferences), null)
  const chinese = '我今天很高興，去學校。'
  assert.equal(wordAt(chinese, 9, 9, preferences).word, '學校')
  assert.equal(wordAt(chinese, 5, 5, preferences).word, '高興')
  assert.equal(wordAt(chinese, 4, 4, preferences).word, '很')
  assert.equal(wordAt('猫が好きです', 1, 1, preferences).word, '猫')

  assert.deepEqual(detectLangs('ねこ', preferences), ['ja'])
  assert.deepEqual(detectLangs('猫', preferences), ['zh', 'yue', 'ja'])
  assert.deepEqual(detectLangs('猫', { han: 'ja', latin: 'en' }), [
    'ja',
    'zh',
    'yue',
  ])
  assert.deepEqual(detectLangs('chat', { han: 'zh', latin: 'fr' }), [
    'fr',
    'en',
    'tl',
  ])
  assert.deepEqual(detectLangs('사랑', preferences), [])
})

test('dictionary replacements keep the first letter case', () => {
  assert.equal(matchCase('happy', 'glad'), 'glad')
  assert.equal(matchCase('Happy', 'glad'), 'Glad')
  assert.equal(matchCase('Élan', 'flair'), 'Flair')
  assert.equal(matchCase('happy', 'English'), 'English')
  assert.equal(matchCase('猫', 'ねこ'), 'ねこ')
})

test('dictionary providers map host failures, share pages, and cache answers', async () => {
  const requests = []
  const responses = []
  const getText = async (request) => {
    requests.push(request.url)
    return responses.shift()
  }
  const wiktionary = wiktionaryProvider(getText)
  responses.push({ ok: false, code: 'unavailable' })
  await assert.rejects(wiktionary.lookup('chat', 'en', signal), {
    reason: 'offline',
  })
  responses.push({
    ok: true,
    value: { text: await fixture('wiktionary-chat.json') },
  })
  assert.equal((await wiktionary.lookup('Chat', 'fr', signal))[0].lang, 'fr')
  assert.equal((await wiktionary.lookup('chat', 'en', signal))[0].lang, 'en')
  assert.deepEqual(requests, [
    'https://en.wiktionary.org/api/rest_v1/page/definition/chat',
    'https://en.wiktionary.org/api/rest_v1/page/definition/chat',
  ])
  responses.push({ ok: false, code: 'http-status', status: 404 })
  assert.deepEqual(await wiktionary.lookup('qwzx', 'en', signal), [])
  responses.push({ ok: false, code: 'http-status', status: 429 })
  await assert.rejects(wiktionary.lookup('glad', 'en', signal), {
    reason: 'rate-limited',
  })
  responses.push({ ok: false, code: 'permission-denied' })
  await assert.rejects(wiktionary.lookup('glad', 'en', signal), {
    reason: 'denied',
  })

  requests.length = 0
  const datamuse = datamuseProvider(getText)
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
  const related = await datamuse.related('happy', 'en', signal)
  assert.equal(related.antonyms[0], 'sad')
  assert.deepEqual(await datamuse.related('Happy', 'en', signal), related)
  assert.deepEqual(requests, [
    'https://api.datamuse.com/words?rel_syn=happy&max=24',
    'https://api.datamuse.com/words?rel_ant=happy&max=24',
  ])
})

test('dictionary registry prefers installed offline packs and falls back online', async () => {
  const registry = createRegistry()
  const entry = (name) => ({
    term: 'x',
    lang: 'ja',
    senses: [{ gloss: name }],
    source: { name, license: 'test' },
  })
  let installed = false
  registry.register({
    id: 'online',
    label: 'Online',
    kind: 'online',
    languages: ['ja', 'en'],
    lookup: async (_term, lang) => {
      if (lang === 'en') throw new DictionaryError('offline')
      return [entry('online')]
    },
  })
  const dispose = registry.register({
    id: 'pack',
    label: 'Pack',
    kind: 'offline',
    languages: ['ja', 'zh'],
    installed: () => installed,
    lookup: async () => [entry('pack')],
  })
  const ask = (provider, lang) => provider.lookup('x', lang, signal)
  let result = await gather(registry, ['ja'], 'lookup', ask)
  assert.equal(result.found[0].value[0].source.name, 'online')
  result = await gather(registry, ['zh'], 'lookup', ask)
  assert.deepEqual(result, { found: [], installable: ['zh'] })
  installed = true
  result = await gather(registry, ['ja'], 'lookup', ask)
  assert.equal(result.found[0].value[0].source.name, 'pack')
  result = await gather(registry, ['en'], 'lookup', ask)
  assert.equal(result.failure, 'offline')
  result = await gather(registry, ['en', 'ja'], 'lookup', ask)
  assert.equal(result.failure, undefined)
  assert.equal(result.found.length, 1)
  dispose()
  assert.equal((await registry.providers('ja', 'lookup')).length, 1)
  assert.equal((await registry.providers('ja', 'related')).length, 0)
})

test('dictionary sends nothing online when an installed offline pack answers', async () => {
  const registry = createRegistry()
  const calls = []
  const provider = (id, kind, languages, answers) => ({
    id,
    label: id,
    kind,
    languages,
    lookup: async (term, lang) => {
      calls.push(`${id}:${lang}`)
      return answers.includes(lang)
        ? [
            {
              term,
              lang,
              senses: [{ gloss: id }],
              source: { name: id, license: 'test' },
            },
          ]
        : []
    },
  })
  registry.register(
    provider(
      'online',
      'online',
      ['zh', 'yue', 'ja', 'en', 'tl', 'fr'],
      ['zh', 'ja', 'en', 'fr'],
    ),
  )
  registry.register(provider('pack', 'offline', ['zh', 'en'], ['zh']))
  const ask = (item, lang) => item.lookup('x', lang, signal)
  let result = await gather(registry, ['yue', 'zh', 'ja'], 'lookup', ask)
  assert.deepEqual(calls, ['pack:zh'])
  assert.deepEqual(
    result.found.map(({ lang }) => lang),
    ['zh'],
  )

  calls.length = 0
  result = await gather(registry, ['en', 'tl', 'fr'], 'lookup', ask)
  assert.deepEqual(calls, ['pack:en', 'online:en'])
  assert.deepEqual(
    result.found.map(({ lang }) => lang),
    ['en'],
  )

  calls.length = 0
  result = await gather(registry, ['tl', 'fr', 'en'], 'lookup', ask)
  assert.deepEqual(calls, ['pack:en', 'online:tl', 'online:fr'])
  assert.equal(result.found[0].value[0].source.name, 'online')
})

test('dictionary sends no follow-up request after the lookup is closed', async () => {
  const requests = []
  let controller = new AbortController()
  const getText = async (request) => {
    requests.push(request.url)
    controller.abort()
    return { ok: false, code: 'http-status', status: 404 }
  }
  await assert.rejects(
    datamuseProvider(getText).related('happy', 'en', controller.signal),
    DictionaryError,
  )
  assert.deepEqual(requests, [
    'https://api.datamuse.com/words?rel_syn=happy&max=24',
  ])
  requests.length = 0
  controller = new AbortController()
  await assert.rejects(
    wiktionaryProvider(getText).lookup('Happy', 'en', controller.signal),
    DictionaryError,
  )
  assert.deepEqual(requests, [
    'https://en.wiktionary.org/api/rest_v1/page/definition/happy',
  ])
})

test('dictionary retries malformed answers instead of caching them', async () => {
  const requests = []
  const responses = [
    { ok: true, value: { text: '<html>busy</html>' } },
    { ok: true, value: { text: await fixture('wiktionary-happy.json') } },
    { ok: true, value: { text: '{"oops":1}' } },
    {
      ok: true,
      value: { text: await fixture('datamuse-synonyms-happy.json') },
    },
    { ok: true, value: { text: '[]' } },
  ]
  const getText = async (request) => {
    requests.push(request.url)
    return responses.shift()
  }
  const wiktionary = wiktionaryProvider(getText)
  await assert.rejects(wiktionary.lookup('happy', 'en', signal), {
    reason: 'unavailable',
  })
  assert.equal((await wiktionary.lookup('happy', 'en', signal)).length, 3)
  const datamuse = datamuseProvider(getText)
  await assert.rejects(datamuse.related('happy', 'en', signal), {
    reason: 'unavailable',
  })
  assert.equal(
    (await datamuse.related('happy', 'en', signal)).synonyms[0],
    'halcyon',
  )
  assert.equal(requests.length, 5)
})

test('dictionary tries the capitalized page when the lowercase one lacks the language', async () => {
  const requests = []
  const responses = {
    'https://en.wiktionary.org/api/rest_v1/page/definition/paris':
      '{"en":[{"partOfSpeech":"Noun","definitions":[{"definition":"plaster"}]}]}',
    'https://en.wiktionary.org/api/rest_v1/page/definition/Paris':
      '{"fr":[{"partOfSpeech":"Proper noun","definitions":[{"definition":"Paris"}]}]}',
  }
  const wiktionary = wiktionaryProvider(async (request) => {
    requests.push(request.url)
    return { ok: true, value: { text: responses[request.url] } }
  })
  const [entry] = await wiktionary.lookup('Paris', 'fr', signal)
  assert.equal(entry.partOfSpeech, 'proper noun')
  assert.equal(requests.length, 2)
})
