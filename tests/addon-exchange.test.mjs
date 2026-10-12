import assert from 'node:assert/strict'
import test from 'node:test'
import { createAddonExchange } from '../src/renderer/src/addon-exchange.ts'

const provider = { id: 'provider' }
const consumer = { id: 'consumer', requires: { addons: [{ id: 'provider' }] } }

test('exported APIs become visible after startup and are cleared on stop', async () => {
  const exchange = createAddonExchange()
  const host = exchange.scope(provider, async () => {})
  const client = exchange.scope(consumer, async () => host.commit())
  const api = { version: 1, add: (a, b) => a + b }
  host.exports.provide(api)
  assert.equal(client.addons.get('provider'), undefined)
  assert.equal(await client.addons.ready('provider'), api)
  assert.equal(client.addons.get('provider').add(2, 3), 5)
  host.dispose()
  assert.equal(client.addons.get('provider'), undefined)
  assert.equal(await client.addons.ready('provider'), undefined)
  assert.throws(() => host.exports.provide(api), /stopped/)
})

test('old publications and scopes cannot clear replacement APIs', () => {
  const exchange = createAddonExchange()
  const client = exchange.scope(consumer, async () => {})
  const first = exchange.scope(provider, async () => {})
  const api = { version: 1 }
  const remove = first.exports.provide(api)
  first.exports.provide(api)
  first.commit()
  remove()
  assert.equal(client.addons.get('provider'), api)
  const replacement = exchange.scope(provider, async () => {})
  const next = { version: 2 }
  replacement.exports.provide(next)
  replacement.commit()
  first.dispose()
  assert.equal(client.addons.get('provider'), next)
  client.dispose()
  assert.equal(client.addons.get('provider'), undefined)
})

test('only declared dependencies can be read or activated', async () => {
  const exchange = createAddonExchange()
  let activations = 0
  const client = exchange.scope(consumer, async () => {
    activations++
  })
  assert.throws(
    () => client.addons.get('other'),
    /declare other in requires.addons/,
  )
  await assert.rejects(
    client.addons.ready('other'),
    /declare other in requires.addons/,
  )
  assert.equal(activations, 0)
  client.dispose()
  assert.equal(await client.addons.ready('provider'), undefined)
  assert.equal(activations, 0)
})

test('unavailable dependencies and failed activations resolve without an API', async () => {
  const exchange = createAddonExchange()
  const client = exchange.scope(consumer, async () => {
    throw new Error('disabled')
  })
  assert.equal(await client.addons.ready('provider'), undefined)
  const optional = exchange.scope(
    {
      id: 'optional',
      requires: { addons: [{ id: 'provider', optional: true }] },
    },
    async () => {},
  )
  assert.equal(await optional.addons.ready('provider'), undefined)
})

test('exports require a plain object and a positive integer API version', () => {
  const scope = createAddonExchange().scope(provider, async () => {})
  for (const api of [
    null,
    undefined,
    [],
    () => {},
    {},
    { version: 0 },
    { version: -1 },
    { version: 1.5 },
    { version: '1' },
    { version: Infinity },
    Object.create({ version: 1 }),
  ])
    assert.throws(
      () => scope.exports.provide(api),
      /plain object with a positive integer version/,
    )
  assert.doesNotThrow(() =>
    scope.exports.provide(Object.assign(Object.create(null), { version: 1 })),
  )
})
