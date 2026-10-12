import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const output = await build({
  stdin: {
    contents: `export {default as addon} from './index.tsx';
      export {readPreferences, writePreferences} from './settings.ts';`,
    resolveDir: fileURLToPath(
      new URL('../src/addons/autocomplete/', import.meta.url),
    ),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  resolveExtensions: ['.ts', '.tsx', '.js'],
  plugins: [
    {
      name: 'headless-controls',
      setup(build) {
        build.onResolve({ filter: /^\.\.\/ui$/ }, () => ({
          path: 'ui',
          namespace: 'test',
        }))
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const Button = () => null',
        }))
      },
    },
  ],
})
const { addon, readPreferences, writePreferences } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
)

const view = {
  documentId: 'document',
  documentGeneration: 1,
  viewId: 'source',
  viewGeneration: 1,
}

test('preference changes persist queued learning and pending saves before reconfiguration', async (t) => {
  for (const flushed of [false, true]) {
    for (const [name, change] of Object.entries({
      learning: { learning: false },
      suggestions: { suggest: false },
      document: { excludedDocuments: ['document'] },
      workspace: { excludedWorkspaces: ['notes'] },
      languages: { languages: ['fr'] },
    })) {
      await t.test(
        `${name}, ${flushed ? 'pending save' : 'queued observation'}`,
        async (t) => {
          t.mock.timers.enable({ apis: ['setTimeout'] })
          const values = new Map()
          globalThis.localStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
          }
          let idle
          globalThis.requestIdleCallback = (run) => {
            idle = run
            return 1
          }
          globalThis.cancelIdleCallback = () => {
            idle = undefined
          }
          t.after(() => {
            addon.stop()
            delete globalThis.localStorage
            delete globalThis.requestIdleCallback
            delete globalThis.cancelIdleCallback
          })
          let snapshot = {
            status: 'ready',
            revision: 0,
            value: { version: 1, entries: [] },
          }
          let writes = 0
          let input
          const subscribers = new Set()
          await addon.start({
            addons: { ready: async () => ({ version: 1 }) },
            storage: {
              global: async () => ({
                snapshot: () => snapshot,
                subscribe(listener) {
                  subscribers.add(listener)
                  return () => subscribers.delete(listener)
                },
                async set(value) {
                  writes++
                  snapshot = {
                    status: 'ready',
                    revision: snapshot.revision + 1,
                    value: structuredClone(value),
                  }
                  for (const listener of subscribers) listener()
                  return { status: 'saved' }
                },
              }),
            },
            editorViews: { getActive: () => view, onDidChangeActive() {} },
            editor: {
              getDocument: () => ({ id: 'document', name: 'note.md' }),
              onDocumentChange() {},
              onTypingContext(listener) {
                input = listener
              },
              async registerCompletionProvider() {},
            },
            workspace: {
              get: async () => ({
                id: 'notes',
                name: 'notes',
                activePath: 'note.md',
              }),
              async subscribeChanges() {},
            },
            commands: { register() {} },
          })
          let before = ''
          let version = 0
          const type = (text) => {
            for (const char of text) {
              const from = before.length
              before += char
              input({
                view,
                editor: 'source',
                kind: 'input',
                contentVersion: ++version,
                before,
                after: '',
                prose: { before, after: '' },
                selection: { anchor: before.length, head: before.length },
                change: { from, to: from, insertedLength: 1 },
              })
            }
          }
          type('wild ')
          assert.equal(typeof idle, 'function')
          if (flushed) idle()
          assert.equal(writes, 0)
          writePreferences({ ...readPreferences(), ...change })
          assert.equal(idle, undefined)
          if (name !== 'languages') {
            type('secret ')
            assert.equal(idle, undefined)
          }
          await new Promise(setImmediate)
          assert.equal(writes, 1)
          assert.ok(
            snapshot.value.entries.every((row) => row.word !== 'secret'),
          )
          const word = snapshot.value.entries.find((row) => row.word === 'wild')
          assert.ok(word)
          assert.equal(word.scope, 'notes')
          assert.deepEqual(word.languages, ['en'])
          t.mock.timers.tick(1000)
          await new Promise(setImmediate)
          assert.equal(writes, 1)
        },
      )
    }
  }
})
