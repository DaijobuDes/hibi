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
    removeItem: (key) => values.delete(key),
  }
  return import(`../src/addons/autocomplete/settings.ts?test=${serial++}`)
}
test('autocomplete inherits existing language and Tab preferences and respects its own updates', async () => {
  const settings = await preferences({
    'hibi:dictionary': { latin: 'fr' },
    'hibi:dictionary:typing': {
      suggest: false,
      tabAccepts: false,
      languages: ['tl', 'ja', 'fr', 'tl', 'en', 7],
    },
  })
  const initial = settings.readPreferences()
  assert.equal(initial.suggest, false)
  assert.equal(initial.tabAccepts, false)
  assert.deepEqual(initial.languages, ['tl', 'fr', 'en'])
  assert.equal(localStorage.getItem('hibi:dictionary:typing'), null)
  assert.deepEqual(
    JSON.parse(localStorage.getItem('hibi:autocomplete')),
    initial,
  )
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
test('privacy preferences reload across windows and after resubscribing', async (t) => {
  const settings = await preferences({})
  const events = new EventTarget()
  globalThis.window = events
  t.after(() => {
    delete globalThis.window
  })
  const initial = settings.readPreferences()
  let changes = 0
  const stop = settings.onPreferencesChange(() => changes++)
  const next = { ...initial, learning: false, excludedWorkspaces: ['private'] }
  localStorage.setItem('hibi:autocomplete', JSON.stringify(next))
  const notify = (key, storageArea = localStorage) =>
    events.dispatchEvent(
      Object.assign(new Event('storage'), { key, storageArea }),
    )
  notify('unrelated')
  notify('hibi:autocomplete', {})
  assert.equal(changes, 0)
  notify('hibi:autocomplete')
  assert.equal(changes, 1)
  assert.deepEqual(settings.readPreferences(), next)
  stop()
  localStorage.setItem(
    'hibi:autocomplete',
    JSON.stringify({ ...next, suggest: false }),
  )
  notify('hibi:autocomplete')
  assert.equal(changes, 1)
  const again = settings.onPreferencesChange(() => changes++)
  assert.equal(settings.readPreferences().suggest, false)
  notify(null)
  assert.equal(changes, 2)
  again()
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

test('migration keeps the old preferences if saving fails and retries on next subscription', async () => {
  const previous = {
    suggest: false,
    tabAccepts: false,
    languages: ['de', 'en'],
  }
  const settings = await preferences({ 'hibi:dictionary:typing': previous })
  const set = localStorage.setItem
  localStorage.setItem = () => {
    throw new Error('quota')
  }
  assert.deepEqual(settings.readPreferences().languages, previous.languages)
  assert.equal(localStorage.getItem('hibi:autocomplete'), null)
  assert.deepEqual(
    JSON.parse(localStorage.getItem('hibi:dictionary:typing')),
    previous,
  )
  localStorage.setItem = set
  const stop = settings.onPreferencesChange(() => {})
  assert.equal(settings.readPreferences().suggest, false)
  assert.equal(localStorage.getItem('hibi:dictionary:typing'), null)
  stop()
})

test('saved autocomplete preferences win over stale dictionary settings', async () => {
  const settings = await preferences({
    'hibi:autocomplete': {
      languages: ['fr', 'de'],
      suggest: true,
      tabAccepts: true,
    },
    'hibi:dictionary:typing': {
      languages: ['en'],
      suggest: false,
      tabAccepts: false,
    },
  })
  const next = settings.readPreferences()
  assert.deepEqual(next.languages, ['fr', 'de'])
  assert.equal(next.suggest, true)
  assert.equal(next.tabAccepts, true)
  assert.equal(localStorage.getItem('hibi:dictionary:typing'), null)
})

test('fresh autocomplete defaults to English without a second language filter', async () => {
  const settings = await preferences({})
  assert.deepEqual(settings.readPreferences().languages, ['en'])
})
