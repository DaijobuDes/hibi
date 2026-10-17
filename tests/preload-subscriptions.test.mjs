import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const evaluate = new Function(
  'require',
  'process',
  await readFile(new URL('../out/preload/index.cjs', import.meta.url), 'utf8'),
)

for (const [method, channel, returnsTransport] of [
  ['onAddonReload', 'addons:reload', true],
  ['onGlobalShortcut', 'global-shortcut:invoked', true],
  ['onUpdateChanged', 'updates:changed', false],
  ['onAddonStorageChanged', 'addon-storage:changed', true],
  ['onWorkspaceListChanged', 'workspace:list-changed', false],
  ['onAddonHotkeysChanged', 'addon-hotkeys:changed', true],
  ['onAddonCommand', 'addon-hotkeys:invoke', true],
  ['onCommand', 'app:command', false],
])
  test(`${method} strips events and disposes only its own subscription`, () => {
    const transport = Object.assign(new EventEmitter(), {
      invoke: async () => null,
      send() {},
    })
    const exposed = new Map()
    evaluate(
      () => ({
        ipcRenderer: transport,
        contextBridge: { exposeInMainWorld: exposed.set.bind(exposed) },
      }),
      { isMainFrame: true },
    )
    const calls = []
    const callback = (...args) => calls.push(args)
    const stop = exposed.get('hibi')[method](callback)
    const keep = exposed.get('hibi')[method](callback)
    const event = { sender: transport }
    const payload = Object.freeze({ id: 'probe' })
    transport.emit(channel, event, payload, 'extra')
    assert.deepEqual(calls, [[payload], [payload]])
    assert.equal(calls[0][0], payload)
    assert.equal(stop(), returnsTransport ? transport : undefined)
    stop()
    assert.equal(transport.listenerCount(channel), 1)
    transport.emit(channel, event, payload)
    assert.deepEqual(calls, [[payload], [payload], [payload]])
    keep()
    assert.equal(transport.emit(channel, event, payload), false)
    assert.equal(calls.length, 3)
  })
