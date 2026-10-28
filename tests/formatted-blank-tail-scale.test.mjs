import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTask } from 'node:timers/promises'
import { EditorState, Text } from '@codemirror/state'
import { GFM, parser } from '@lezer/markdown'
import { ChunkedMarkdownParser } from '../src/renderer/src/chunked-markdown.ts'
import { blockBreak } from '../src/renderer/src/formatted-commands.ts'
import { sourceEditorTextCooperatively } from '../src/renderer/src/source-session.ts'
import { SourceStore } from '../src/shared/source-buffer.ts'

const markdown = parser.configure(GFM)
const prefix = `first\n\n${'old tail\n\n'.repeat(20000)}`
function partialTree(doc) {
  const parse = new ChunkedMarkdownParser(markdown, markdown).startChunkedParse(
    {
      length: doc.length,
      lineChunks: false,
      chunk: (from) => doc.sliceString(from, Math.min(from + 4096, doc.length)),
      read: (from, to) => doc.sliceString(from, to),
    },
    [],
    { from: 0, to: 8192 },
  )
  let tree
  while (!tree) tree = parse.advance()
  assert.ok(tree.topNode.lastChild.to < 20000)
  return tree
}

function newlines(length) {
  let result = Text.empty,
    power = Text.of(['', ''])
  while (length) {
    if (length % 2) result = result.append(power)
    length = Math.floor(length / 2)
    if (length) power = power.append(power)
  }
  return result
}

for (const mixed of [false, true]) {
  test(`unparsed ${mixed ? 'mixed whitespace' : 'LF'} tails keep indexed Enter work at 1 and 50 MiB`, async (t) => {
    for (const mib of [1, 50]) {
      let store, doc
      if (mixed) {
        const loader = SourceStore.loader({ tabId: 'enter-scale', revision: 0 })
        for (let at = 0; at < prefix.length; at += 65536)
          loader.append(prefix.slice(at, at + 65536))
        const chunk = `${' \t'.repeat(2047)} \n`
        for (let at = 0; at < mib * 2 ** 20; at += chunk.length)
          loader.append(chunk)
        store = loader.finish()
        doc = await sourceEditorTextCooperatively(store.snapshot(), {
          signal: new AbortController().signal,
          yieldTask: nextTask,
        })
      } else doc = Text.of(prefix.split('\n')).append(newlines(mib * 2 ** 20))
      const tree = partialTree(doc)
      const state = EditorState.create({
        doc,
        selection: { anchor: prefix.length },
      })
      let lines = 0,
        units = 0,
        materializations = 0
      const lineAt = doc.lineAt.bind(doc)
      doc.lineAt = (...args) => {
        lines++
        return lineAt(...args)
      }
      const slice = state.sliceDoc.bind(state)
      state.sliceDoc = (...args) => {
        const result = slice(...args)
        units += result.length
        return result
      }
      doc.toString = () => {
        materializations++
        throw new Error('full source read')
      }
      store?.counters(true)
      const spec = blockBreak(state, tree)
      const source = store?.counters()
      const next = state.update(spec).state
      assert.equal(next.doc.length, doc.length + 2)
      assert.equal(next.selection.main.head, prefix.length + 2)
      assert.equal(lines, 2)
      assert.equal(units, 0)
      assert.equal(materializations, 0)
      if (source) {
        assert.ok(source.unitsScanned <= 1024)
        assert.ok(source.nodeVisits <= 32)
        assert.ok(source.sourceUnitsRead <= 2)
        assert.equal(source.materializations, 0)
      }
      t.diagnostic(
        JSON.stringify({ mib, mixed, lines, units, materializations, source }),
      )
    }
  })
}
