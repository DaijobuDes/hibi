import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema, Node } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import { markdownSerializer } from '../src/renderer/src/markdown-serialization.ts'
import { preserveRichSource } from '../src/renderer/src/rich-source-preservation.ts'

const extensions = [
  StarterKit.configure({ trailingNode: false }),
  TableKit,
  TaskList,
  TaskItem,
  Image,
]
const schema = getSchema(extensions)
const manager = new MarkdownManager({
  extensions,
  markedOptions: { gfm: true },
})

test('cached serialization matches the full manager through contextual blocks and 160 edits', () => {
  const source =
    '# Heading\n\nWords **bold** and *italic*, [link](https://example.com). 😀 é\n\n> quote\n>\n> - nested\n> - list\n\n1. numbered\n2. item\n\n- [ ] task\n- [x] done\n\n| a | b |\n|---|---|\n| c | d |\n\n```js\nconst value = "code"\n```\n\n![alt](photo.png)\n\nlast paragraph'
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(manager.parse(source)),
  })
  const serialize = markdownSerializer(manager, true)
  const verify = () => {
    const result = serialize(state.doc)
    const expected = manager.serialize(state.doc.toJSON())
    assert.equal(result.source, expected)
    assert.equal(serialize(state.doc).rendered, 0)
    return result
  }
  verify()
  for (let index = 0; index < 160; index++) {
    const texts = []
    state.doc.descendants((node, pos) => {
      if (node.isText) texts.push({ node, pos })
    })
    const { node, pos } = texts[index % texts.length]
    const insert = ['a', '*', '_', '[', '&', '😀', '\\', '́'][index % 8]
    let tr = state.tr.insertText(insert, pos)
    if (index % 11 === 0)
      tr = tr.addMark(pos, pos + insert.length, schema.marks.bold.create())
    if (index % 17 === 0 && node.text.length > 2)
      tr = tr.delete(pos, pos + insert.length)
    state = state.apply(tr)
    assert.ok(verify().rendered <= 2)
  }
  state = state.apply(
    state.tr.insert(
      0,
      schema.nodes.paragraph.create(
        null,
        schema.text('inserted before every cached block'),
      ),
    ),
  )
  verify()
  state = state.apply(state.tr.delete(0, state.doc.firstChild.nodeSize))
  verify()
})

test('empty paragraphs, entities, delimiters, and source preservation match full serialization', () => {
  for (const source of [
    '',
    ' ',
    '&nbsp;\n\n&nbsp;',
    '\u00a0\n\n\u2003\uFEFF',
    '&nbsp; text &nbsp;',
    '&nbsp;&amp;nbsp;',
    'alpha beta '.repeat(50000),
    '---\n\nkey: value\n\n---',
    '\\*literal\\* &amp; &lt;span&gt;',
    '**a *b* c**',
    '~~strike~~',
    '>\n>\n> text',
    'one\n\n\n\ntwo',
  ]) {
    const doc = schema.nodeFromJSON(manager.parse(source))
    const result = markdownSerializer(manager, true)(doc)
    const expected = manager.serialize(doc.toJSON())
    assert.equal(result.source, expected, source)
  }
})

test('native empty paragraphs serialize as blank lines and pass source preservation', () => {
  const { core, parser, options } = markdownConfiguration([])
  const schema = getSchema(core)
  const manager = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  const original = '# heading\r\n\r\nfirst\r\n'
  const before = schema.nodeFromJSON(manager.parse(original))
  const after = schema.nodes.doc.create(null, [
    ...before.content.content,
    schema.nodes.paragraph.create(),
    schema.nodes.paragraph.create(),
    schema.nodes.paragraph.create(null, schema.text('second ')),
    schema.nodes.paragraph.create(),
    schema.nodes.paragraph.create(),
  ])
  for (const blockLocal of [true, false]) {
    const serialize = markdownSerializer(manager, blockLocal)
    const source = serialize(after).source
    assert.equal(source, '# heading\n\nfirst\n\n\n\n\n\nsecond \n\n\n\n')
    assert.doesNotMatch(source, /&nbsp;|\u00a0/)
    assert.ok(schema.nodeFromJSON(manager.parse(source)).eq(after))
    const preserved = preserveRichSource(
      original,
      serialize(before).source,
      source,
      (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
    )
    assert.equal(
      preserved,
      '# heading\r\n\r\nfirst\r\n\r\n\r\n\r\n\r\n\r\nsecond \r\n\r\n\r\n\r\n\r\n',
    )
    const empty = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(),
      schema.nodes.paragraph.create(),
    ])
    assert.equal(serialize(empty).source, '')
  }
})

test('rich soft breaks render as spaces and retain their source after an unrelated edit', () => {
  const { core, addons, parser, options } = markdownConfiguration([
    {
      markedOptions: { gfm: true },
      richExtensions: [TaskList, TaskItem.configure({ nested: true })],
    },
  ])
  const extensions = [...core, ...addons]
  const schema = getSchema(extensions)
  const manager = new MarkdownManager({
    extensions,
    marked: parser,
    markedOptions: options,
  })
  for (const [block, text] of [
    ['a\nb', 'a b'],
    ['a \nb', 'a b'],
    ['1. a\n   b', 'a b'],
    ['a\t\n\tb', 'a b'],
    ['**a\nb**', 'a b'],
    ['> a\n> b', 'a b'],
    ['- a\n  b', 'a b'],
    ['a\nb\n=====', 'a b'],
    ['- [ ] t\n  p\n  q', 'tp q'],
  ]) {
    const original = `${block}\n\nelsewhere`
    const before = schema.nodeFromJSON(manager.parse(original))
    assert.equal(before.firstChild.textContent, text, block)
    const after = schema.nodes.doc.create(null, [
      before.firstChild,
      schema.nodes.paragraph.create(null, schema.text('edited elsewhere')),
    ])
    const preserved = preserveRichSource(
      original,
      manager.serialize(before.toJSON()),
      manager.serialize(after.toJSON()),
      (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
    )
    assert.equal(preserved, `${block}\n\nedited elsewhere`)
    assert.ok(schema.nodeFromJSON(manager.parse(preserved)).eq(after))
  }
  assert.equal(parser.lexer('p\nq')[0].tokens[0].text, 'p q')
  assert.equal(parser.parse('a\nb'), '<p>a\nb</p>\n')
  assert.equal(manager.parse('a  \nb').content[0].content[1].type, 'hardBreak')
  assert.equal(
    schema.nodeFromJSON(manager.parse('```\na\nb\n```')).firstChild.textContent,
    'a\nb',
  )
})

test('rich insertions at normalized delimiters preserve source only with a unique full parse', () => {
  for (const source of ['_em_', '**bold**', '~~strike~~']) {
    const original = `${source}\r\n\r\nelsewhere\r\n`
    const before = schema.nodeFromJSON(manager.parse(original))
    const state = EditorState.create({ schema, doc: before })
    for (const atEnd of [false, true]) {
      const after = state.apply(
        state.tr.insertText('!', atEnd ? before.firstChild.nodeSize - 1 : 1),
      ).doc
      const preserved = preserveRichSource(
        original,
        manager.serialize(before.toJSON()),
        manager.serialize(after.toJSON()),
        (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
      )
      const text = before.firstChild.textContent
      assert.equal(
        preserved,
        original.replace(text, atEnd ? `${text}!` : `!${text}`),
      )
    }
  }
  assert.equal(
    preserveRichSource('_em_', '*em*', '*em!*', () => false),
    null,
  )
  assert.equal(
    preserveRichSource('m_*', 'm*', 'm!*', () => true),
    null,
    'one-sided anchors must not choose between multiple proven source edits',
  )
})

test('normalized delimiter edits find nearby anchors after more than 32 earlier matches', () => {
  const original = `${'day\n\n'.repeat(40)}_y_\n`
  const before = schema.nodeFromJSON(manager.parse(original))
  const state = EditorState.create({ schema, doc: before })
  const after = state.apply(
    state.tr.insertText('!', before.content.size - 1),
  ).doc
  assert.equal(
    preserveRichSource(
      original,
      manager.serialize(before.toJSON()),
      manager.serialize(after.toJSON()),
      (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
    ),
    original.replace('_y_', '_y!_'),
  )
})

test('occurrence order preserves edits after a table shrinks during serialization', () => {
  const pad = (text) => text + ' '.repeat(60)
  const table = [
    `| ${pad('a')} | ${pad('b')} |`,
    `|${'-'.repeat(62)}|${'-'.repeat(62)}|`,
    ...Array.from(
      { length: 300 },
      (_, index) => `| ${pad(`c${index}`)} | ${pad('d')} |`,
    ),
  ].join('\n')
  const items = Array.from({ length: 20 }, () => '- _y_')
  const original = `${table}\n\n${items.join('\n')}\n`
  const before = schema.nodeFromJSON(manager.parse(original))
  const state = EditorState.create({ schema, doc: before })
  let occurrence = 0
  let position = -1
  before.descendants((node, at) => {
    if (node.isText && node.text === 'y' && ++occurrence === 10)
      position = at + 1
  })
  assert.notEqual(position, -1)
  const after = state.apply(state.tr.insertText('!', position)).doc
  let parses = 0
  const preserved = preserveRichSource(
    original,
    manager.serialize(before.toJSON()),
    manager.serialize(after.toJSON()),
    (candidate) => {
      parses++
      return schema.nodeFromJSON(manager.parse(candidate)).eq(after)
    },
    7,
  )
  items[9] = '- _y!_'
  assert.equal(preserved, `${table}\n\n${items.join('\n')}\n`)
  assert.ok(parses <= 7, 'one of eight parses is reserved for the baseline')
})

test('plain CRLF paragraphs preserve exact line endings when q becomes qq', () => {
  const original = 'p\r\n\r\nq'
  const before = schema.nodeFromJSON(manager.parse(original))
  const state = EditorState.create({ schema, doc: before })
  const after = state.apply(
    state.tr.insertText('q', before.content.size - 1),
  ).doc
  assert.equal(
    preserveRichSource(
      original,
      manager.serialize(before.toJSON()),
      manager.serialize(after.toJSON()),
      (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
    ),
    'p\r\n\r\nqq',
  )
})

test('source preservation caps distinct candidate parses including failures', () => {
  for (const throws of [false, true]) {
    const candidates = new Set()
    let parses = 0
    const result = preserveRichSource(
      `${'day\n\n'.repeat(40)}_y_\n`,
      `${'day\n\n'.repeat(40)}*y*`,
      `${'day\n\n'.repeat(40)}*y!*`,
      (candidate) => {
        parses++
        assert.ok(!candidates.has(candidate), 'candidate parsed more than once')
        candidates.add(candidate)
        if (throws) throw new Error('invalid candidate')
        return false
      },
    )
    assert.equal(result, null)
    assert.equal(parses, 8)
  }
})

test('undeclared serializers retain the full-document path and custom document joining', () => {
  let generation = 0
  const CustomDocument = Node.create({
    name: 'doc',
    topNode: true,
    content: 'block+',
    renderMarkdown: (node, helpers) =>
      `${generation}:${helpers.renderChildren(node.content, '\n')}`,
  })
  const customExtensions = [
    StarterKit.configure({ document: false }),
    CustomDocument,
  ]
  const customSchema = getSchema(customExtensions)
  const customManager = new MarkdownManager({ extensions: customExtensions })
  const serialize = markdownSerializer(customManager, false)
  const doc = customSchema.nodeFromJSON(customManager.parse('text'))
  assert.equal(serialize(doc).source, '0:text')
  generation++
  assert.equal(serialize(doc).source, '1:text')
})
