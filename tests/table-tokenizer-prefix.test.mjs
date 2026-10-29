import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Editor,
  flattenExtensions,
  getExtensionField,
  Node,
} from '@tiptap/core'
import { Table, TableKit } from '@tiptap/extension-table'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { StarterKit } from '@tiptap/starter-kit'
import { Marked } from 'marked'
import {
  guardNativeTableTokenizer,
  NativeTableKit,
} from '../src/addons/markdown/table-tokenizer.ts'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'

const original = getExtensionField(Table, 'markdownTokenizer')
const guarded = getExtensionField(
  guardNativeTableTokenizer(Table),
  'markdownTokenizer',
)
const cases = [
  '',
  'ordinary',
  'ordinary\nsecond',
  'a | b\n--- | ---',
  '| a | b |\n| :--- | ---: |\n| c | d |',
  '| `a|b` | c |\n|---|---|\n| d | `e|f` |\n\n# after',
  'header\n---',
  'header\n---|---\n`a|b`',
  '\n|---|---\n`a|b`',
  '\n\n|---|---\n`a|b`',
  'a | b\n--- | ---\n\n| `later|code` | d |',
  'a | b\n--- | ---\n# heading\n\nlast',
  'a | b\n--- | ---\n> quote',
  'a | b\n--- | ---\n```txt\na|b\n```',
  'a | b\r\n--- | ---\r\nlast',
  'a | b\n--- | ---\n \n| `c|d` | e |',
]
for (const header of ['plain', '| a |', '`a|b`', 'a \\| b', ''])
  for (const separator of [
    '---',
    '|---|',
    ' - | :--: ',
    '\t|---|\t',
    '| ::: |',
    '|',
    '---||',
    '|---|\r',
    '',
    '|-x-|',
    '|-\u00a0|',
  ])
    for (const ending of ['', '\n', '\n| `a|b` | c |\n\nparagraph\n|---|'])
      cases.push(`${header}\n${separator}${ending}`)

function tokenize(tokenizer, source) {
  const calls = []
  const helper = {
    inlineTokens: () => [],
    blockTokens: (value) => {
      calls.push(value)
      return [
        { type: 'table', raw: `${value}\n`, header: [], align: [], rows: [] },
      ]
    },
  }
  return { value: tokenizer.tokenize(source, [], helper), calls }
}

test('two-line guards preserve native table starts, tokens and helper calls', () => {
  for (const source of cases) {
    assert.equal(guarded.start(source), original.start(source), source)
    assert.deepEqual(
      tokenize(guarded, source),
      tokenize(original, source),
      source,
    )
  }
})

test('ordinary paragraph tails are never split by guarded table detection', (t) => {
  const source = `ordinary\nsecond line\n${'remaining prose\n'.repeat(20000)}`
  const split = String.prototype.split
  let fullSplits = 0
  t.mock.method(String.prototype, 'split', function (...args) {
    if (String(this) === source && args[0] === '\n') fullSplits++
    return split.apply(this, args)
  })
  assert.equal(original.start(source), -1)
  assert.equal(fullSplits, 1)
  fullSplits = 0
  assert.equal(tokenize(original, source).value, undefined)
  assert.equal(fullSplits, 1)
  fullSplits = 0
  for (let index = 0; index < 100; index++) {
    assert.equal(guarded.start(source), -1)
    assert.equal(tokenize(guarded, source).value, undefined)
  }
  assert.equal(fullSplits, 0)
})

test('table kit retains schema options and leaves custom tokenizers unchanged', () => {
  const options = {
    table: { resizable: false, HTMLAttributes: { class: 'fixture' } },
    tableHeader: false,
  }
  const before = flattenExtensions([TableKit.configure(options)]),
    after = flattenExtensions([NativeTableKit.configure(options)])
  assert.deepEqual(
    after.map((extension) => extension.name),
    before.map((extension) => extension.name),
  )
  for (const [index, extension] of after.entries()) {
    assert.deepEqual(extension.options, before[index].options)
    assert.equal(
      extension.config.parseMarkdown,
      before[index].config.parseMarkdown,
    )
  }
  const replacement = Table.extend({
    markdownTokenizer: {
      ...original,
      start: () => 9,
      tokenize: () => ({ type: 'custom', raw: 'ordinary' }),
    },
  })
  assert.equal(guardNativeTableTokenizer(replacement), replacement)
  const unrelated = Node.create({ name: 'unrelated' })
  assert.equal(guardNativeTableTokenizer(unrelated), unrelated)
})

test('guarded table schema preserves native JSON for escaped and code-span pipes', () => {
  const managers = [TableKit, NativeTableKit].map(
    (kit) =>
      new MarkdownManager({
        marked: new Marked({ gfm: true }),
        extensions: [
          StarterKit,
          kit.configure({ table: { resizable: false } }),
        ],
      }),
  )
  for (const source of [
    ...cases,
    '| `one|two` | **bold** |\n|---|---|\n| `a|b` | [ref] |\n\n[ref]: /target',
    '| ``a`|b`` | value |\n|:--|--:|\n| c \\| d | e |',
    '> | `a|b` | c |\n> |---|---|\n> | d | e |\n\nlast',
  ])
    assert.deepEqual(
      managers[1].parse(source),
      managers[0].parse(source),
      source,
    )
})

// Native table edits read back as their Markdown does, through the app's plugins.
const nativeTables = (source) => {
  const configuration = markdownConfiguration([
    {
      id: 'github',
      markedOptions: { gfm: true },
      richExtensions: [
        NativeTableKit.configure({ table: { resizable: false } }),
      ],
    },
  ])
  const editor = new Editor({
    element: null,
    extensions: [
      ...configuration.core,
      Markdown.configure({
        marked: configuration.parser,
        markedOptions: configuration.options,
      }),
      ...configuration.addons,
    ],
    content: source,
    contentType: 'markdown',
  })
  const canonical = (doc) =>
    editor.schema.nodeFromJSON(
      editor.markdown.parse(editor.markdown.serialize(doc.toJSON())),
    )
  const state = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.extensionManager.plugins,
  })
  return { editor, canonical, state }
}

test('a native table that loses its header row keeps the empty one its Markdown has', () => {
  const { editor, canonical, state } = nativeTables(
    'plain\n\n| aa | bb |\n| :-- | --- |\n| cell | tail |',
  )
  let at = -1
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'table') at = offset
  })
  const header = state.doc.nodeAt(at).firstChild
  // Chromium's edit from a paragraph into a body cell removes the whole header row.
  const tr = state.tr.delete(at + 1, at + 1 + header.nodeSize)
  const source = editor.markdown.serialize(tr.doc.toJSON())
  const next = state.applyTransaction(tr).state
  assert.equal(editor.markdown.serialize(next.doc.toJSON()), source)
  assert.ok(next.doc.eq(canonical(next.doc)), JSON.stringify(next.doc.toJSON()))
  const row = next.doc.nodeAt(at).firstChild
  assert.deepEqual(
    row.content.content.map((cell) => [
      cell.type.name,
      cell.textContent,
      cell.attrs.align,
    ]),
    [
      ['tableHeader', '', 'left'],
      ['tableHeader', '', null],
    ],
  )
  // Edits that keep a header append nothing.
  const typed = state.applyTransaction(
    state.tr.insertText('x', state.doc.content.size - 3),
  )
  assert.equal(typed.transactions.length, 1)
})

// ProseMirror's read of Chromium's edit (traced in the app) adds a cell for the
// typed text and resolves the browser caret in front of it. Its slice may start
// earlier and repeat the typed text in the cell before.
for (const [typed, from, before] of [
  ['Z', 26, []],
  ['c', 25, [{ type: 'text', text: 'c' }]],
])
  test(`text typed over a range across native cells leaves the caret after it: ${typed}`, () => {
    const tables = nativeTables(
      'plain\n\n| aa | bb |\n| --- | --- |\n| c*ell* | *ta*il |',
    )
    const { editor, canonical } = tables
    let state = tables.state.apply(
      tables.state.tr.setSelection(
        TextSelection.create(tables.state.doc, 26, 35),
      ),
    )
    assert.equal(state.doc.textBetween(26, 35), 'ellta')
    const input = (data) => {
      for (const plugin of state.plugins)
        plugin.props.handleDOMEvents?.beforeinput?.(
          { state, composing: false },
          { inputType: 'insertText', data },
        )
    }
    input(typed)
    const tr = state.tr.step(
      ReplaceStep.fromJSON(state.schema, {
        stepType: 'replace',
        from,
        to: 35,
        slice: {
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: before }],
            },
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'italic' }], text: typed },
                  ],
                },
              ],
            },
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
          ],
          openStart: 2,
          openEnd: 2,
        },
      }),
    )
    state = state.applyTransaction(
      tr.setSelection(TextSelection.create(tr.doc, 30)),
    ).state
    // Whether the caret is collapsed, its cell, and the text around it there.
    const caret = (state) => [
      state.selection.empty,
      state.selection.$head.index(2),
      state.selection.$head.parent.textContent.slice(
        0,
        state.selection.$head.parentOffset,
      ),
      state.selection.$head.parent.textContent.slice(
        state.selection.$head.parentOffset,
      ),
    ]
    assert.deepEqual(caret(state), [true, 1, typed, ''])
    input('Q')
    state = state.applyTransaction(state.tr.insertText('Q')).state
    assert.deepEqual(caret(state), [true, 1, typed + 'Q', ''])
    assert.equal(
      editor.markdown.serialize(state.doc.toJSON()),
      `plain\n\n\n|     | aa   | bb  |\n| --- | ---- | --- |\n| c   | *${typed}Q* | il  |\n`,
    )
    assert.ok(state.doc.eq(canonical(state.doc)))
  })
