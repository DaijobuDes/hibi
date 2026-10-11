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

test('native HTML entities decode once and survive full and cached serialization', async (t) => {
  const { core, parser, options } = markdownConfiguration([])
  const schema = getSchema(core)
  const manager = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  for (const [name, source, text, saved, href] of [
    ['named', '&copy;', '©', '©'],
    ['decimal', '&#169;', '©', '©'],
    ['hexadecimal', '&#xA9;', '©', '©'],
    ['ampersand', '&amp;', '&', '&amp;'],
    ['encoded named entity', '&amp;copy;', '&copy;', '&amp;copy;'],
    ['numeric ampersand', '&#38;copy;', '&copy;', '&amp;copy;'],
    ['encoded numeric entity', '&amp;#169;', '&#169;', '&amp;#169;'],
    ['numeric angle entity', '&#38;lt;', '&lt;', '&amp;lt;'],
    ['nonbreaking space', 'a&nbsp;b', 'a\u00a0b', 'a&nbsp;b'],
    ['lone nonbreaking space', '&nbsp;', '\u00a0', '&nbsp;'],
    ['lone numeric space', '&#160;', '\u00a0', '&nbsp;'],
    ['lone hexadecimal space', '&#xA0;', '\u00a0', '&nbsp;'],
    ['visible named pair', '&NotEqualTilde;', '\u2242\u0338', '\u2242\u0338'],
    ['em space', 'a&emsp;b', 'a\u2003b', 'a&emsp;b'],
    [
      'zero width space',
      'a&ZeroWidthSpace;b',
      'a\u200bb',
      'a&NegativeMediumSpace;b',
    ],
    ['word joiner', 'a&NoBreak;b', 'a\u2060b', 'a&NoBreak;b'],
    ['numeric newline', 'a&#10;b', 'a\nb', 'a&NewLine;b'],
    ['numeric carriage return', 'a&#13;b', 'a\rb', 'a&#13;b'],
    ['tab', 'a&Tab;b', 'a\tb', 'a&Tab;b'],
    ['bold nbsp', '**&nbsp;**', '\u00a0', '**&nbsp;**'],
    ['nbsp paragraphs', '&nbsp;\n\n&nbsp;', '\u00a0\u00a0', '&nbsp;\n\n&nbsp;'],
    ['escaped ampersand', '\\&copy;', '&copy;', '&amp;copy;'],
    ['missing semicolon', '&copy', '&copy', '&amp;copy'],
    ['unknown entity', '&unknown;', '&unknown;', '&amp;unknown;'],
    ['numeric limit', '&#0000000169;', '&#0000000169;', '&amp;#0000000169;'],
    ['invalid numeric', '&#0; &#xD800;', '\ufffd \ufffd', '\ufffd \ufffd'],
    [
      'inline punctuation',
      '&lt;x&gt;&ast;&lowbar;&lbrack;&bsol;',
      '<x>*_[\\',
      '&lt;x&gt;\\*\\_\\[\\\\',
    ],
    ['heading marker', '&num; heading', '# heading', '\\# heading'],
    ['bullet marker', '&minus; item', '− item', '− item'],
    ['ascii bullet marker', '&#45; item', '- item', '\\- item'],
    ['ordered marker', '1&period; item', '1. item', '1\\. item'],
    ['code nbsp', '`a\u00a0b`', 'a\u00a0b', '`a\u00a0b`'],
    [
      'code span',
      '`&copy; &#169; &nbsp;`',
      '&copy; &#169; &nbsp;',
      '`&copy; &#169; &nbsp;`',
    ],
    [
      'code block',
      '```\n&copy; &#169; &nbsp;\n```',
      '&copy; &#169; &nbsp;',
      '```\n&copy; &#169; &nbsp;\n```',
    ],
    [
      'link text',
      '[&copy;](https://example.com)',
      '©',
      '[©](https://example.com)',
      'https://example.com',
    ],
    [
      'link URL',
      '[link](https://example.com/?a=&copy;&b=&amp;copy;)',
      'link',
      '[link](https://example.com/?a=©&amp;b=&amp;copy;)',
      'https://example.com/?a=©&b=&copy;',
    ],
    [
      'numeric link URL',
      '[link](https://example.com/&#169;/&#xA9;)',
      'link',
      '[link](https://example.com/©/©)',
      'https://example.com/©/©',
    ],
    [
      'link URL delimiters',
      '[link](https://example.com/a&#32;b&#41;c)',
      'link',
      '[link](https://example.com/a&#32;b&rpar;c)',
      'https://example.com/a b)c',
    ],
    [
      'autolink entities stay literal',
      '<https://example.com/?a=&copy;>',
      'https://example.com/?a=&copy;',
      '[https://example.com/?a=&amp;copy;](https://example.com/?a=&amp;copy;)',
      'https://example.com/?a=&copy;',
    ],
    [
      'link title',
      '[&copy;](https://example.com "&copy; &quot;title&quot; &amp;copy;")',
      '©',
      '[©](https://example.com "© &quot;title&quot; &amp;copy;")',
      'https://example.com',
    ],
  ]) {
    await t.test(name, () => {
      const before = schema.nodeFromJSON(manager.parse(source))
      assert.equal(before.textContent, text)
      if (href)
        assert.equal(before.firstChild.firstChild.marks[0].attrs.href, href)
      for (const blockLocal of [false, true]) {
        const serialize = markdownSerializer(manager, blockLocal)
        const output = serialize(before).source
        assert.equal(output, saved)
        const after = schema.nodeFromJSON(manager.parse(output))
        assert.ok(after.eq(before), output)
        assert.equal(serialize(after).source, output)
      }
    })
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
