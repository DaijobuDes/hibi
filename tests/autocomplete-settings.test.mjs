import assert from 'node:assert/strict'
import test from 'node:test'

let serial = 0
const preferences = async (data) => {
  const values = new Map(
    Object.entries(data).map(([key, value]) => [key, JSON.stringify(value)]),
  )
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  return import(`../src/addons/autocomplete/settings.ts?test=${serial++}`)
}
test('autocomplete inherits existing language and Tab preferences and respects its own updates', async () => {
  const settings = await preferences({
    'hibi:dictionary': { latin: 'fr' },
    'hibi:dictionary:typing': { suggest: false, tabAccepts: false },
  })
  const initial = settings.readPreferences()
  assert.equal(initial.suggest, false)
  assert.equal(initial.tabAccepts, false)
  assert.deepEqual(initial.languages, ['fr', 'en', 'tl'])
  let changes = 0
  const stop = settings.onPreferencesChange(() => changes++)
  const next = {
    ...initial,
    suggest: true,
    learning: false,
    excludedDocuments: ['document'],
    excludedWorkspaces: ['workspace'],
  }
  settings.writePreferences(next)
  assert.equal(settings.readPreferences(), next)
  assert.equal(changes, 1)
  stop()
  settings.writePreferences(next)
  assert.equal(changes, 1)
})
test('autocomplete validates stored languages and exclusions, and defaults safely', async () => {
  const settings = await preferences({
    'hibi:autocomplete': {
      languages: ['en', 'bad', 'en', 'tl'],
      excludedDocuments: ['note', 3, null],
      excludedWorkspaces: {},
    },
  })
  const value = settings.readPreferences()
  assert.deepEqual(value.languages, ['en', 'tl'])
  assert.deepEqual(value.excludedDocuments, ['note'])
  assert.deepEqual(value.excludedWorkspaces, [])
  assert.equal(value.learning, true)
  assert.equal(value.suggest, true)
  assert.equal(value.tabAccepts, true)
})
