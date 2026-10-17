import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/preload/index.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: { 'import.meta.env.DEV': 'false' },
})
const evaluate = new Function('require', 'process', outputFiles[0].text)

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
    const exposed = {}
    evaluate(
      (id) => {
        assert.equal(id, 'electron')
        return {
          ipcRenderer: transport,
          contextBridge: {
            exposeInMainWorld: (name, api) => {
              exposed[name] = api
            },
          },
        }
      },
      { isMainFrame: true },
    )
    const calls = []
    const callback = (...args) => calls.push(args)
    const stop = exposed.hibi[method](callback)
    const keep = exposed.hibi[method](callback)
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
    assert.equal(transport.listenerCount(channel), 0)
    transport.emit(channel, event, payload)
    assert.equal(calls.length, 3)
  })
