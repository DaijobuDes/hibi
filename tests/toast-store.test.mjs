import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: ['src/ui/toast-store.ts'],
  bundle: true,
  format: 'esm',
  write: false,
})
const { createToastService } = await import(
  `data:text/javascript,${encodeURIComponent(bundled.outputFiles[0].text)}`
)

test('toast actions run once, close their notification, and survive updates', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const service = createToastService()
  const runs = []
  const handle = service.api.show({
    message: 'update available',
    duration: 0,
    action: { label: 'Open update settings', run: () => runs.push('first') },
  })
  service.api.show({ message: 'plain', duration: 0 })
  const [actionable, plain] = service.snapshot().items
  assert.equal(actionable.action.label, 'Open update settings')
  assert.equal(plain.action, undefined)

  service.select(plain.id)
  assert.equal(service.snapshot().items[1].closing, false)

  handle.update({ message: 'still available' })
  assert.equal(service.snapshot().items[0].action.label, 'Open update settings')
  handle.update({
    action: { label: 'Show update', run: () => runs.push('second') },
  })
  service.select(actionable.id)
  service.select(actionable.id)
  assert.deepEqual(runs, ['second'])
  assert.equal(service.snapshot().items[0].closing, true)
  t.mock.timers.tick(160)
  assert.deepEqual(
    service.snapshot().items.map((item) => item.message),
    ['plain'],
  )
})

test('a throwing toast action still closes its notification', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const service = createToastService()
  service.api.show({
    message: 'broken',
    action: {
      label: 'Fail',
      run: () => {
        throw new Error('addon failure')
      },
    },
  })
  const [entry] = service.snapshot().items
  assert.throws(() => service.select(entry.id), /addon failure/)
  assert.equal(service.snapshot().items[0].closing, true)
})

test('disposed owners cannot run stale toast actions', () => {
  const service = createToastService()
  const scope = service.scope()
  let ran = false
  scope.api.show({
    message: 'owned',
    action: { label: 'Run', run: () => (ran = true) },
  })
  const [entry] = service.snapshot().items
  scope.dispose()
  service.select(entry.id)
  assert.equal(ran, false)
  assert.equal(service.snapshot().items.length, 0)
})
