import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTask } from 'node:timers/promises'
import { EditorState } from '@codemirror/state'
import {
  createSourceSession,
  sourceEditorTextCooperatively,
} from '../src/renderer/src/source-session.ts'
import { sourceWhitespace } from '../src/renderer/src/source-whitespace.ts'
import { DocumentSession } from '../src/shared/document-session.ts'
import { SourceStore } from '../src/shared/source-buffer.ts'

const key = { tabId: 'whitespace', revision: 0 }
const textFor = (snapshot) =>
  sourceEditorTextCooperatively(snapshot, {
    signal: new AbortController().signal,
    yieldTask: nextTask,
  })

test('source whitespace matches every JavaScript whitespace unit and normalized endpoint', async () => {
  const whitespace =
    '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
  const raw = `😀\ud800x\r\n${whitespace}\r\n\udfffz \t`
  const store = new SourceStore(raw, key)
  const text = await textFor(store.snapshot())
  const normalized = raw.replace(/\r\n?/g, '\n')
  assert.equal(
    sourceWhitespace(EditorState.create({ doc: ' ' }).doc, 0),
    undefined,
  )
  for (let from = 0; from <= normalized.length; from++)
    for (let to = from; to <= normalized.length; to++) {
      const range = normalized.slice(from, to)
      assert.equal(sourceWhitespace(text, from, to), !/\S/.test(range))
    }
  const clone = SourceStore.fromSnapshot(store.snapshot())
  assert.equal(clone.snapshot().isWhitespace(6, 6 + whitespace.length), true)
})

test('source whitespace follows admitted edits, hidden echoes and undo without changing older snapshots', async () => {
  const session = new DocumentSession('x\r\n \t', key, 0, {
    enqueue: () => {},
    onError: (error) => {
      throw error
    },
  })
  const bridge = createSourceSession(session)
  const before = session.snapshot()
  const original = await textFor(before)
  const view = {
    state: EditorState.create({ doc: original }),
    update(transactions) {
      for (const transaction of transactions) this.state = transaction.state
    },
  }
  const detach = bridge.attach(view)
  const check = (expected) =>
    assert.equal(sourceWhitespace(view.state.doc, 2), expected)
  check(true)
  bridge.dispatch(
    [view.state.update({ changes: { from: 3, insert: 'z' } })],
    view,
  )
  check(false)
  assert.equal(sourceWhitespace(original, 2), true)
  assert.equal(before.isWhitespace(3), true)
  assert.equal(bridge.undo(), true)
  check(true)
  assert.equal(bridge.redo(), true)
  check(false)
  bridge.setVisible(false)
  session.edit([{ from: 4, to: 5, insert: '\u00a0' }], 'source', 'replace')
  check(false)
  bridge.setVisible(true)
  check(true)
  detach()
  session.dispose()
})

test('indexed whitespace proofs keep bounded reads at 1 and 50 MiB', async (t) => {
  for (const size of [1, 50]) {
    const loader = SourceStore.loader(key)
    const prefix = 'first\n\n'
    const chunk = `${' \t'.repeat(2047)} \n`
    loader.append(prefix)
    for (let at = 0; at < size * 2 ** 20; at += chunk.length)
      loader.append(chunk)
    const store = loader.finish()
    const snapshot = store.snapshot()
    const text = await textFor(snapshot)
    store.counters(true)
    assert.equal(snapshot.isWhitespace(prefix.length), true)
    const raw = store.counters(true)
    assert.equal(sourceWhitespace(text, prefix.length), true)
    const indexed = store.counters()
    assert.ok(raw.unitsScanned <= 64, JSON.stringify(raw))
    assert.ok(indexed.unitsScanned <= 1024, JSON.stringify(indexed))
    assert.ok(indexed.nodeVisits <= 32, JSON.stringify(indexed))
    assert.equal(indexed.materializations, 0)
    assert.ok(indexed.sourceUnitsRead <= 2)
    t.diagnostic(JSON.stringify({ mib: size, raw, indexed }))
  }
})

test('whitespace bindings do not retain disposed source snapshots', {
  skip: !globalThis.gc,
}, async () => {
  const make = async () => {
    const store = new SourceStore('x\n \t'.repeat(1000), key)
    return {
      text: await textFor(store.snapshot()),
      snapshot: new WeakRef(store.snapshot()),
    }
  }
  const { text, snapshot } = await make()
  for (let tries = 0; tries < 20; tries++) {
    await nextTask()
    globalThis.gc()
    if (!snapshot.deref()) break
  }
  assert.equal(snapshot.deref(), undefined)
  assert.equal(sourceWhitespace(text, 0), undefined)
})
