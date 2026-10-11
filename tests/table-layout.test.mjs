import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

// CommonJS throughout, so the bundle and this test share one ProseMirror.
const require = createRequire(import.meta.url)
const { Schema } = require('@tiptap/pm/model')
const { EditorState, PluginKey } = require('@tiptap/pm/state')

globalThis.tableLayoutEcho = new PluginKey('documentSourceEcho')
const bundle = await build({
  entryPoints: ['src/renderer/src/table-layout.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  plugins: [
    {
      name: 'source-echo',
      setup(build) {
        build.onResolve({ filter: /rich-source-session$/ }, () => ({
          path: 'echo',
          namespace: 'source-echo',
        }))
        build.onLoad({ filter: /.*/, namespace: 'source-echo' }, () => ({
          contents: 'export const richSourceEcho = globalThis.tableLayoutEcho',
        }))
      },
    },
  ],
})
const module = { exports: {} }
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  module,
  module.exports,
  require,
)
const { tableLayout } = module.exports
const [plugin] = tableLayout.config.addProseMirrorPlugins.call({
  options: { tabId: 'test' },
})

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'text*' },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: '(tableHeader | tableCell)+' },
    tableHeader: { content: 'paragraph' },
    tableCell: { content: 'paragraph' },
  },
})
const paragraph = (text) =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const row = (type, cells) =>
  schema.nodes.tableRow.create(
    null,
    cells.map((text) => schema.nodes[type].create(null, paragraph(text))),
  )
const table = (header, body) =>
  schema.nodes.table.create(null, [
    row('tableHeader', header),
    ...body.map((cells) => row('tableCell', cells)),
  ])
const create = (...blocks) =>
  EditorState.create({
    schema,
    plugins: [plugin],
    doc: schema.nodes.doc.create(null, blocks),
  })
const tables = (state) => {
  const found = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    found.push(pos)
    return false
  })
  return found
}
const size = (state, table, axis, index, value) =>
  state.apply(
    state.tr.setMeta(plugin, {
      size: { table, axis, index, value, commit: true },
    }),
  )
/** Inline styles by table, then by row or header cell. */
const styles = (state) => {
  const found = plugin.getState(state).decorations.find()
  return tables(state).map((pos) => {
    const node = state.doc.nodeAt(pos)
    const style = (from) =>
      found.find((decoration) => decoration.from === from)?.type.attrs.style ??
      ''
    const rows = []
    node.forEach((_, offset) => {
      rows.push(style(pos + 1 + offset))
    })
    const columns = []
    node.firstChild.forEach((_, offset) => {
      columns.push(style(pos + 2 + offset))
    })
    return { columns, rows }
  })
}

test('source sync does not move sizes between tables', () => {
  const first = table(['a', 'b'], [['1', '2']])
  const second = table(['c', 'd'], [['3', '4']])
  let state = create(first, second)
  state = size(state, tables(state)[0], 'column', 0, 380)
  const swapped = state.tr.replaceWith(0, state.doc.content.size, [
    second,
    first,
  ])
  state = state.apply(swapped.setMeta(globalThis.tableLayoutEcho, true))
  assert.deepEqual(plugin.getState(state).tables, [])
  assert.deepEqual(
    styles(state).map(({ columns }) => columns),
    [
      ['', ''],
      ['', ''],
    ],
  )
})

test('row and column sizes follow inserted and deleted rows and columns', () => {
  let state = create(
    paragraph('before'),
    table(
      ['a', 'b'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    ),
  )
  const at = () => tables(state)[0]
  state = size(state, at(), 'row', 2, 131)
  state = size(state, at(), 'column', 1, 200)
  // Insert a body row above body row 1.
  const rowStart = (index) => {
    let start = at() + 1
    for (let i = 0; i < index; i++)
      start += state.doc.nodeAt(at()).child(i).nodeSize
    return start
  }
  state = state.apply(
    state.tr.insert(rowStart(1), row('tableCell', ['n', 'n'])),
  )
  assert.deepEqual(styles(state)[0].rows, [
    '',
    '',
    '',
    '--table-row-height: 131px',
  ])
  // Delete the new row again.
  state = state.apply(state.tr.delete(rowStart(1), rowStart(2)))
  assert.deepEqual(styles(state)[0].rows, ['', '', '--table-row-height: 131px'])
  // Insert a column before the first one, in every row.
  let tr = state.tr
  state.doc.nodeAt(at()).forEach((_, offset, index) => {
    tr.insert(
      tr.mapping.map(at() + 1 + offset + 1),
      schema.nodes[index ? 'tableCell' : 'tableHeader'].create(
        null,
        paragraph('x'),
      ),
    )
  })
  state = state.apply(tr)
  assert.deepEqual(styles(state)[0].columns, ['', '', 'width: 200px'])
  // Delete the sized column.
  tr = state.tr
  state.doc.nodeAt(at()).forEach((current, offset) => {
    const cell =
      at() +
      1 +
      offset +
      1 +
      current.child(0).nodeSize +
      current.child(1).nodeSize
    tr.delete(
      tr.mapping.map(cell),
      tr.mapping.map(cell + current.child(2).nodeSize),
    )
  })
  state = state.apply(tr)
  assert.deepEqual(styles(state)[0].columns, ['', ''])
  assert.deepEqual(plugin.getState(state).tables[0].columns, [])
})
