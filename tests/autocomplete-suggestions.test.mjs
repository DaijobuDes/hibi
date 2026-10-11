import assert from 'node:assert/strict'
import test from 'node:test'
import { createPersonalModel } from '../src/addons/autocomplete/model.ts'
import {
  autocompleteCompletions,
  precedingWords,
} from '../src/addons/autocomplete/suggestions.ts'

const request = (before, prose = { before, after: '' }) => ({
  view: {
    documentId: 'doc',
    documentGeneration: 1,
    viewId: 'view',
    viewGeneration: 1,
  },
  contentVersion: 1,
  editor: 'source',
  documentLength: before.length,
  selection: { anchor: before.length, head: before.length },
  before,
  after: '',
  prose,
  trigger: { kind: 'input', character: before.at(-1) },
})
function fixture() {
  const model = createPersonalModel()
  let epoch = 0
  let session = { scope: 'workspace', documentId: 'doc', personal: true }
  let settings = {
    suggest: true,
    learning: true,
    tabAccepts: true,
    languages: ['en'],
    excludedDocuments: [],
    excludedWorkspaces: [],
  }
  const dictionary = {
    version: 1,
    suggestionLanguages: () => ['en', 'tl'],
    customWords: () => [],
    complete: async () => [{ lang: 'en', words: ['crack', 'crayon'] }],
  }
  const provider = autocompleteCompletions(
    dictionary,
    () => settings,
    { suggest: model.suggest, epoch: () => epoch },
    () => session,
    (lang) => lang,
  )
  return {
    model,
    dictionary,
    provider,
    settings: (next) => {
      settings = { ...settings, ...next }
    },
    scope: (scope) => {
      session = { ...session, scope }
    },
    clear: () => {
      model.clear()
      epoch++
    },
  }
}
const signal = () => new AbortController().signal
test('provider combines baseline, exact personal spelling, custom words and next-word context', async () => {
  const f = fixture()
  const words = async (before) =>
    (await f.provider(request(before), signal())).map((item) => item.insertText)
  assert.equal((await words('cra'))[0], 'crack')
  f.dictionary.customWords = () => [{ word: 'craycray', lang: 'en' }]
  assert.equal((await words('cra'))[0], 'craycray')
  for (let i = 0; i < 80; i++)
    f.model.observe({
      scope: 'workspace',
      languages: ['en'],
      context: ['that', 'was'],
      word: 'craZy',
      kind: 'typed',
    })
  assert.equal((await words('that was cra'))[0], 'craZy')
  f.dictionary.customWords = () => []
  f.dictionary.complete = async () =>
    assert.fail('next-word prediction must use local context')
  const next = await f.provider(request('bro that was '), signal())
  assert.equal(next[0].insertText, 'craZy')
  assert.equal(next[0].from, 'bro that was '.length)
  assert.equal(next[0].to, next[0].from)
  f.settings({ learning: false })
  assert.deepEqual(await words('bro that was '), [])
})

test('unsafe prose and unavailable sessions do not query dictionary or learning', async () => {
  const f = fixture()
  f.dictionary.complete = async () =>
    assert.fail('unsafe context queried vocabulary')
  assert.deepEqual(await f.provider(request('cra', null), signal()), [])
  assert.deepEqual(
    await f.provider({ ...request('cra'), prose: undefined }, signal()),
    [],
  )
  assert.deepEqual(
    await f.provider(
      {
        ...request('cra'),
        view: { ...request('cra').view, documentId: 'other' },
      },
      signal(),
    ),
    [],
  )
  f.settings({ suggest: false })
  assert.deepEqual(await f.provider(request('cra'), signal()), [])
})

test('late offline results are dropped after clear, workspace switch or changed preferences', async () => {
  for (const change of [
    (f) => f.clear(),
    (f) => f.scope('other'),
    (f) => f.settings({ learning: false }),
  ]) {
    const f = fixture()
    let resolve
    f.dictionary.complete = () =>
      new Promise((done) => {
        resolve = done
      })
    const pending = f.provider(request('cra'), signal())
    change(f)
    resolve([{ lang: 'en', words: ['crack'] }])
    assert.deepEqual(await pending, [])
  }
})

test('phrase context never extracts fragments from addresses, identifiers or secret-looking tokens', () => {
  assert.deepEqual(precedingWords('bro that was '), ['that', 'was'])
  assert.deepEqual(precedingWords('done. next '), ['next'])
  assert.deepEqual(precedingWords('one\ntwo '), ['two'])
  for (const text of [
    'secret@example.test ',
    'token_abcdef ',
    'abc123 ',
    'path/to/file ',
    'host.name ',
  ])
    assert.deepEqual(precedingWords(text), [], text)
  assert.deepEqual(precedingWords('secret@example.test ordinary '), [
    'ordinary',
  ])
})
