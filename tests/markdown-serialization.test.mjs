import assert from 'node:assert/strict'
import test from 'node:test'
import { Extension, getSchema, Mark, Node } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import {
  Table,
  TableCell,
  TableHeader,
  TableKit,
  TableRow,
} from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { Marked } from 'marked'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import {
  markdownSerializer,
  paragraphEscaper,
} from '../src/renderer/src/markdown-serialization.ts'
import {
  preserveRichSource,
  sameRichSourceDocument,
} from '../src/renderer/src/rich-source-preservation.ts'

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

test('flavor paragraph rules compose before core escaping with render context', () => {
  const seen = []
  const { core, parser, options } = markdownConfiguration([
    {
      paragraphRules: [
        {
          escape(source, ctx) {
            seen.push([source, ctx.parentType])
            return source.replaceAll('?', '\\?')
          },
        },
        { escape: (source) => source.replaceAll('!', '\\!') },
      ],
    },
    {
      paragraphRules: [
        {
          escape(source) {
            assert.equal(source, '# why\\?\\!')
            return source
          },
        },
      ],
    },
  ])
  const schema = getSchema(core)
  const manager = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  const source = '\\# why\\?\\!\n\n> \\# why\\?\\!'
  const doc = schema.nodeFromJSON(manager.parse(source))
  for (const blockLocal of [true, false]) {
    const saved = markdownSerializer(manager, blockLocal)(doc).source
    assert.equal(saved, source)
    assert.ok(schema.nodeFromJSON(manager.parse(saved)).eq(doc))
  }
  assert.deepEqual(seen, [
    ['# why?!', 'doc'],
    ['# why?!', 'blockquote'],
    ['# why?!', 'doc'],
    ['# why?!', 'blockquote'],
  ])
})

test('paragraph rules distinguish literal text from node output without splitting marks', () => {
  const dollarNode = Node.create({
    name: 'dollarNode',
    group: 'inline',
    inline: true,
    atom: true,
    renderMarkdown: () => '$node$',
  })
  const { core, addons, parser, options } = markdownConfiguration([
    {
      richExtensions: [dollarNode],
      paragraphRules: [
        {
          characters: '$#',
          escape(source, { literals }) {
            assert.ok(source.includes('$node$'))
            assert.ok(!source.includes('$text$'))
            for (const [sentinel, character] of literals)
              if (character === '$') source = source.replaceAll(sentinel, '\\$')
            return source
          },
        },
      ],
    },
  ])
  const extensions = [...core, ...addons]
  const schema = getSchema(extensions)
  const manager = new MarkdownManager({
    extensions,
    marked: parser,
    markedOptions: options,
  })
  const json = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '# ' },
          { type: 'text', text: '$te', marks: [{ type: 'bold' }] },
          {
            type: 'text',
            text: 'xt$',
            marks: [{ type: 'bold' }, { type: 'italic' }],
          },
          { type: 'text', text: ' \uE0000\uE001 \uE000\uE0000\uE001 ' },
          { type: 'dollarNode' },
        ],
      },
    ],
  }
  const original = structuredClone(json)
  const doc = schema.nodeFromJSON(json)
  const expected =
    '\\# **\\$te*xt\\$*** \uE0000\uE001 \uE000\uE0000\uE001 $node$'
  assert.equal(manager.serialize(json), expected)
  for (const blockLocal of [true, false])
    assert.equal(markdownSerializer(manager, blockLocal)(doc).source, expected)
  assert.deepEqual(json, original)
})

test('paragraph masking skips code marks and verbatim node output', () => {
  const verbatimMark = Mark.create({
    name: 'verbatimMark',
    code: true,
    renderMarkdown: (_node, helpers) =>
      `<raw>${helpers.renderChildren()}</raw>`,
  })
  const verbatimNode = Node.create({
    name: 'verbatimNode',
    group: 'inline',
    inline: true,
    code: true,
    content: 'text*',
    renderMarkdown: (node, helpers) => helpers.renderChildren(node.content),
  })
  const { core, addons, parser, options } = markdownConfiguration([
    {
      richExtensions: [
        Extension.create({
          name: 'verbatimExtensions',
          addExtensions: () => [verbatimMark.extend({}), verbatimNode],
        }),
      ],
      paragraphRules: [
        {
          characters: '$!',
          escape(source, { literals }) {
            for (const [sentinel, character] of literals)
              source = source.replaceAll(sentinel, `\\${character}`)
            return source
          },
        },
      ],
    },
  ])
  const extensions = [...core, ...addons]
  const manager = new MarkdownManager({
    extensions,
    marked: parser,
    markedOptions: options,
  })
  const text = '$x$ ![x](y)'
  const json = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '$plain$ ' },
          { type: 'text', text, marks: [{ type: 'code' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text, marks: [{ type: 'verbatimMark' }] },
          { type: 'text', text: ' ' },
          { type: 'verbatimNode', content: [{ type: 'text', text }] },
        ],
      },
    ],
  }
  const schema = getSchema(extensions)
  const doc = schema.nodeFromJSON(json)
  for (const blockLocal of [true, false])
    assert.equal(
      markdownSerializer(manager, blockLocal)(doc).source,
      `\\$plain\\$ \`${text}\` <raw>${text}</raw> ${text}`,
    )
})

test('paragraph rule failures name the flavor and abort serialization', async (t) => {
  const thrown = new Error('broken rule')
  for (const [name, transform] of [
    [
      'throw',
      () => {
        throw thrown
      },
    ],
    ['non-string', () => undefined],
    [
      'drop sentinel',
      (source, { literals }) =>
        source.replaceAll(literals.keys().next().value, ''),
    ],
    ['damage sentinel', (source) => source.replaceAll('\uE001', '')],
  ]) {
    await t.test(name, () => {
      const { core, parser, options } = markdownConfiguration([
        { id: 'first', paragraphRules: [{ escape: (source) => source }] },
        {
          id: 'broken.flavor',
          paragraphRules: [{ characters: '$', escape: transform }],
        },
      ])
      const schema = getSchema(core)
      const manager = new MarkdownManager({
        extensions: core,
        marked: parser,
        markedOptions: options,
      })
      const doc = schema.nodeFromJSON(manager.parse('a \\$ b'))
      for (const blockLocal of [true, false])
        assert.throws(
          () => markdownSerializer(manager, blockLocal)(doc),
          (error) => {
            assert.match(error.message, /broken\.flavor/)
            if (name === 'throw') assert.equal(error.cause, thrown)
            return true
          },
        )
    })
  }
})

test('paragraph sentinels survive digit rules and support escaped replacements', () => {
  const { core, parser, options } = markdownConfiguration([
    {
      id: 'digits',
      paragraphRules: [
        { characters: '$!', escape: (source) => source.replace(/\d/g, '#') },
        {
          escape(source, { literals }) {
            for (const [sentinel, character] of literals)
              if (character === '!')
                source = source.replaceAll(sentinel, '&#33;')
            return source
          },
        },
      ],
    },
  ])
  const schema = getSchema(core)
  const manager = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  const doc = schema.nodeFromJSON(manager.parse('a \\$5 ! b'))
  for (const blockLocal of [true, false]) {
    const source = markdownSerializer(manager, blockLocal)(doc).source
    assert.equal(source, 'a $# &#33; b')
    assert.doesNotMatch(source, /[\uE000-\uF8FF]/)
    assert.equal(
      schema.nodeFromJSON(manager.parse(source)).textContent,
      'a $# ! b',
    )
  }
})

test('paragraph sentinels do not collide with link destinations', () => {
  const { core, parser, options } = markdownConfiguration([
    {
      id: 'dollars',
      paragraphRules: [
        {
          characters: '$',
          escape(source, { literals }) {
            for (const [sentinel, character] of literals)
              source = source.replaceAll(sentinel, `\\${character}`)
            return source
          },
        },
      ],
    },
  ])
  const schema = getSchema(core)
  const manager = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  const href = 'https://example.com/\uE000\uE002\uE001'
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text('$x$', [schema.marks.link.create({ href })]),
    ]),
  ])
  for (const blockLocal of [true, false])
    assert.equal(
      markdownSerializer(manager, blockLocal)(doc).source,
      `[\\$x\\$](${href})`,
    )
})

test('paragraph collision checks scan direct and nested text without stringifying', () => {
  const renderParagraph = paragraphEscaper(new Marked(), [
    {
      id: 'literal',
      paragraphRules: [{ characters: '$', escape: (source) => source }],
    },
  ])
  const text = '$ \uE000\uE002\uE001 '
  const nested = '\uE000\uE000\uE002\uE001'
  const node = {
    type: 'paragraph',
    content: [
      { type: 'text', text },
      { type: 'verbatim', content: [{ type: 'text', text: nested }] },
    ],
    toJSON() {
      assert.fail('collision checks must not stringify the paragraph')
    },
  }
  assert.equal(
    renderParagraph(
      node,
      {
        renderChildren: (children) =>
          children.map((child) => child.text ?? child.content[0].text).join(''),
      },
      { index: 0, level: 0, parentType: 'doc' },
    ),
    text + nested,
  )
})

test('paragraph masking skips serialization and copying when no text needs protection', () => {
  const renderParagraph = paragraphEscaper(new Marked(), [
    {
      paragraphRules: [
        {
          characters: '!$',
          escape(source, { literals }) {
            assert.equal(literals.size, 0)
            return source
          },
        },
      ],
    },
  ])
  for (const content of [
    [{ type: 'text', text: 'ordinary paragraph' }],
    [{ type: 'text', text: '$x$ ![x](y)', marks: [{ type: 'code' }] }],
  ]) {
    const node = {
      type: 'paragraph',
      content,
      toJSON() {
        assert.fail('paragraph without sensitive text must not be stringified')
      },
    }
    assert.equal(
      renderParagraph(
        node,
        {
          renderChildren(children) {
            assert.equal(children, content)
            return 'rendered'
          },
        },
        { index: 0, level: 0, parentType: 'doc' },
      ),
      'rendered',
    )
  }
})

test('literal block prefixes survive full and cached serialization', async (t) => {
  for (const gfm of [false, true]) {
    const { core, addons, parser, options } = markdownConfiguration([
      {
        markedOptions: { gfm },
        richExtensions: gfm ? [TableKit, TaskList, TaskItem] : [],
      },
    ])
    const extensions = [...core, ...addons]
    const schema = getSchema(extensions)
    const manager = new MarkdownManager({
      extensions,
      marked: parser,
      markedOptions: options,
    })
    for (const fixture of [
      ...Array.from(
        { length: 6 },
        (_, index) => `\\${'#'.repeat(index + 1)} heading`,
      ),
      '\\#',
      '\\######',
      '\\#\theading',
      '\\#\u00a0heading',
      '\\#\u2003heading',
      '1\\. item',
      '0\\) item',
      '999999999\\. item',
      '1234567890\\. item',
      '1\\.',
      '2\\)',
      '1\\.\titem',
      '1\\.\u00a0item',
      'a\\. item',
      'iii\\) item',
      '\\- item',
      '\\+ item',
      '\\* item',
      '\\-',
      '\\+',
      '\\*',
      '\\---',
      '\\-----',
      '\\- - -',
      ['\\***', '\\*\\*\\*'],
      ['\\___', '\\_\\_\\_'],
      ['\\* * *', '\\* \\* \\*'],
      ['\\_ _ _', '\\_ \\_ \\_'],
      ['\\```js', '\\`\\`\\`js'],
      ['\\~~~js', '\\~\\~\\~js'],
      ['\\>quote', '&gt;quote'],
      ['\\> quote', '&gt; quote'],
      ['\\<script>', '&lt;script&gt;'],
      ['\\<!-- comment -->', '&lt;!-- comment --&gt;'],
      ['\\<?pi?>', '&lt;?pi?&gt;'],
      ['\\<!DOCTYPE html>', '&lt;!DOCTYPE html&gt;'],
      ['\\<![CDATA[text]]>', '&lt;!\\[CDATA\\[text\\]\\]&gt;'],
      ['\\<div>', '&lt;div&gt;'],
      ['\\</div>', '&lt;/div&gt;'],
      ['\\<custom-tag>', '&lt;custom-tag&gt;'],
      ['- \\[ ] task', '- \\[ \\] task'],
      ['- \\[x] task', '- \\[x\\] task'],
      ['\\- [ ] task', '\\- \\[ \\] task'],
      ['\\[label]: /url', '\\[label\\]: /url'],
      '> \\# heading',
      '- \\# heading',
      '1. 2\\. item',
      '- parent\n  - \\+ item',
      '\\# **bold**',
      ['**\\#** heading', '**#** heading'],
      '  \\# heading',
      '   \\- item',
      '#hashtag',
      '####### heading',
      '1.5',
      '1.item',
      '1)item',
      'a.',
      'iii)',
      '-word',
      '+word',
      '--',
      '---word',
      '===',
      '===word',
      '| ordinary | text |',
      '| --- | --- |',
      'text # heading and 1. item',
      '`# heading`',
      '`1. item`',
      ['~~~md\n# heading\n1. item\n~~~', '```md\n# heading\n1. item\n```'],
      ['text\n\\# heading', 'text # heading'],
      ['text\n\\===', 'text ==='],
      ['text\n\\---', 'text ---'],
      'text  \n\\# heading',
      'text  \n1\\. item',
      'text  \n\\===',
      'text  \n\\--',
      'text  \n\\---',
    ]) {
      const [source, expected = source] = Array.isArray(fixture)
        ? fixture
        : [fixture]
      await t.test(
        `${gfm ? 'gfm' : 'commonmark'}: ${JSON.stringify(source)}`,
        () => {
          const doc = schema.nodeFromJSON(manager.parse(source))
          for (const blockLocal of [true, false]) {
            const saved = markdownSerializer(manager, blockLocal)(doc).source
            assert.equal(saved, expected)
            assert.ok(schema.nodeFromJSON(manager.parse(saved)).eq(doc))
          }
        },
      )
    }
  }
})

test('table headers and cells skip block escapes while retaining flavor rules', () => {
  const parents = []
  const { core, addons, parser, options } = markdownConfiguration([
    {
      markedOptions: { gfm: true },
      richExtensions: [TableKit],
      paragraphRules: [
        {
          escape(source, ctx) {
            parents.push(ctx.parentType)
            return source
          },
        },
      ],
    },
  ])
  const extensions = [...core, ...addons]
  const schema = getSchema(extensions)
  const manager = new MarkdownManager({
    extensions,
    marked: parser,
    markedOptions: options,
  })
  const source =
    '\n| -   | 1. x | --- | #   |\n| --- | ---- | --- | --- |\n| -   | 1. x | --- | #   |\n'
  const doc = schema.nodeFromJSON(manager.parse(source))
  for (const blockLocal of [true, false]) {
    const saved = markdownSerializer(manager, blockLocal)(doc).source
    assert.equal(saved, source)
    assert.ok(schema.nodeFromJSON(manager.parse(saved)).eq(doc))
  }
  assert.deepEqual(parents, Array(16).fill('table'))
})

test('multi-paragraph table headers and cells apply declared-character rules', async (t) => {
  for (const [name, richExtensions] of [
    ['kit', [TableKit]],
    ['individual', [Table, TableRow, TableHeader, TableCell]],
    [
      'nested',
      [
        Extension.create({
          name: 'tables',
          addExtensions: () => [TableKit.extend({})],
        }),
      ],
    ],
  ]) {
    await t.test(name, () => {
      const parents = []
      const { core, addons, parser, options } = markdownConfiguration([
        {
          markedOptions: { gfm: true },
          richExtensions,
          paragraphRules: [
            {
              characters: '$',
              escape(source, { parentType, literals }) {
                parents.push(parentType)
                for (const [sentinel, character] of literals)
                  source = source.replaceAll(sentinel, `\\${character}`)
                return source
              },
            },
          ],
        },
      ])
      const extensions = [...core, ...addons]
      const schema = getSchema(extensions)
      const manager = new MarkdownManager({
        extensions,
        marked: parser,
        markedOptions: options,
      })
      const doc = schema.nodeFromJSON({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: ['tableHeader', 'tableCell'].map((type) => ({
              type: 'tableRow',
              content: [
                {
                  type,
                  content: ['$x$', '    # y'].map((text) => ({
                    type: 'paragraph',
                    content: [{ type: 'text', text }],
                  })),
                },
              ],
            })),
          },
        ],
      })
      const cell = '\\$x\\$<br># y'
      const expected = `\n| ${cell} |\n| ${'-'.repeat(cell.length)} |\n| ${cell} |\n`
      for (const blockLocal of [true, false]) {
        const saved = markdownSerializer(manager, blockLocal)(doc).source
        assert.equal(saved, expected)
      }
      assert.deepEqual(parents, Array(8).fill('table'))
    })
  }
})

test('leading indentation remains paragraph text through numeric entities', async (t) => {
  const { core, parser, options } = markdownConfiguration([])
  const schema = getSchema(core)
  const configured = new MarkdownManager({
    extensions: core,
    marked: parser,
    markedOptions: options,
  })
  for (const [source, text] of [
    ['&#32;   code', '    code'],
    ['&#32;       code', '        code'],
    ['&#9;code', '\tcode'],
    ['&#9;\tcode', '\t\tcode'],
    ['&#32;\tcode', ' \tcode'],
    ['&#32; \tcode', '  \tcode'],
    ['&#32;  \tcode', '   \tcode'],
    [' code', ' code'],
    ['  code', '  code'],
    ['   code', '   code'],
  ]) {
    await t.test(JSON.stringify(text), () => {
      // The native manager already decodes these entities without flavor support.
      assert.equal(manager.parse(source).content[0].content[0].text, text)
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text(text)),
      ])
      for (const blockLocal of [true, false]) {
        const saved = markdownSerializer(configured, blockLocal)(doc).source
        assert.equal(saved, source)
        assert.ok(schema.nodeFromJSON(configured.parse(saved)).eq(doc))
      }
    })
  }
  for (const source of ['> &#9;code', '- &#32;   code']) {
    const doc = schema.nodeFromJSON(configured.parse(source))
    for (const blockLocal of [true, false]) {
      const saved = markdownSerializer(configured, blockLocal)(doc).source
      assert.equal(saved, source)
      assert.ok(schema.nodeFromJSON(configured.parse(saved)).eq(doc))
    }
  }
  const renderParagraph = paragraphEscaper(parser, [])
  for (const source of ['text\n    code', 'text  \n\tcode'])
    assert.equal(
      renderParagraph(
        { type: 'paragraph' },
        { renderChildren: () => source },
        { index: 0, level: 0, parentType: 'doc' },
      ),
      source,
    )
})

test('gfm delimiter lines are escaped only when they would form a table', async (t) => {
  for (const gfm of [false, true]) {
    const { core, addons, parser, options } = markdownConfiguration([
      { markedOptions: { gfm }, richExtensions: gfm ? [TableKit] : [] },
    ])
    const extensions = [...core, ...addons]
    const schema = getSchema(extensions)
    const manager = new MarkdownManager({
      extensions,
      marked: parser,
      markedOptions: options,
    })
    for (const [source, table] of [
      ['| a | b |  \n| \\--- | --- |', true],
      ['a | b  \n\\--- | ---', true],
      ['a | b  \n:\\--- | ---:', true],
      ['plain  \n\\---|', true],
      ['| one |  \n|\\---|', true],
      ['text  \n| a | b |  \n| \\--- | --- |', true],
      ['| a | b |  \n|\\---|', true],
      ['plain  \n\\---|---', false],
      ['| a | b |  \n| --- | word |', false],
      ['plain  \n| --- | --- | --- |', false],
      ['a | b  \nword | word', false],
    ]) {
      await t.test(
        `${gfm ? 'gfm' : 'commonmark'}: ${JSON.stringify(source)}`,
        () => {
          const doc = schema.nodeFromJSON(manager.parse(source))
          const expected = gfm && table ? source : source.replace('\\-', '-')
          for (const blockLocal of [true, false]) {
            const saved = markdownSerializer(manager, blockLocal)(doc).source
            assert.equal(saved, expected)
            assert.ok(schema.nodeFromJSON(manager.parse(saved)).eq(doc))
          }
        },
      )
    }
  }
})

test('retained soft breaks escape prefixes on every paragraph line', async (t) => {
  const { core, addons, options } = markdownConfiguration([
    { markedOptions: { gfm: true }, richExtensions: [TableKit] },
  ])
  const extensions = [...core, ...addons]
  const schema = getSchema(extensions)
  // Keep newlines instead of the rich lexer's whitespace normalization.
  const manager = new MarkdownManager({
    extensions,
    marked: new Marked(options),
    markedOptions: options,
  })
  for (const source of [
    'text\n\\# heading',
    'text\n\\###### heading',
    'text\n1\\. item',
    'text\n1\\) item',
    'text\n\\- item',
    'text\n\\+ item',
    'text\n\\* item',
    'text\n\\=',
    'text\n\\===',
    'text\n\\--',
    'text\n\\---',
    'text\n\\- - -',
    '| a | b |\n| \\--- | --- |',
    'text\n| a | b |\n| \\--- | --- |',
    'text\n#hashtag',
    'text\n1.5',
    'text\n| ordinary | text |',
  ]) {
    await t.test(JSON.stringify(source), () => {
      const doc = schema.nodeFromJSON(manager.parse(source))
      for (const blockLocal of [true, false]) {
        const saved = markdownSerializer(manager, blockLocal)(doc).source
        assert.equal(saved, source)
        assert.ok(schema.nodeFromJSON(manager.parse(saved)).eq(doc))
      }
    })
  }
})

test('untouched escaped prefixes retain their original source bytes', () => {
  const { core, addons, parser, options } = markdownConfiguration([
    { markedOptions: { gfm: true }, richExtensions: [TableKit] },
  ])
  const extensions = [...core, ...addons]
  const schema = getSchema(extensions)
  const manager = new MarkdownManager({
    extensions,
    marked: parser,
    markedOptions: options,
  })
  for (const construct of [
    '\\# heading',
    '001\\. item',
    '\\- - -',
    'text\n\\# heading',
    'text\n\\===',
    '\\<div>',
    '| a | b |  \n\\| --- | --- |',
  ]) {
    const original = `${construct.replaceAll('\n', '\r\n')}\r\n\r\nelsewhere\r\n`
    const before = schema.nodeFromJSON(manager.parse(original))
    const after = schema.nodes.doc.create(null, [
      before.firstChild,
      schema.nodes.paragraph.create(null, schema.text('edited elsewhere')),
    ])
    for (const blockLocal of [true, false]) {
      const serialize = markdownSerializer(manager, blockLocal)
      const baseline = serialize(before).source
      assert.equal(
        preserveRichSource(original, baseline, baseline, (candidate) =>
          schema.nodeFromJSON(manager.parse(candidate)).eq(before),
        ),
        original,
      )
      assert.equal(
        preserveRichSource(
          original,
          baseline,
          serialize(after).source,
          (candidate) =>
            schema.nodeFromJSON(manager.parse(candidate)).eq(after),
        ),
        original.replace('elsewhere', 'edited elsewhere'),
      )
    }
  }
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

test('fenced preview spelling caches never mask semantic or custom-grammar changes', () => {
  const names = ['typstBlock', 'mermaidBlock', 'customBlock']
  const schema = getSchema([
    StarterKit,
    ...names.map((name) =>
      Node.create({
        name,
        group: 'block',
        atom: true,
        addAttributes: () => ({
          source: { default: '' },
          raw: { default: '' },
          semantic: { default: '' },
        }),
      }),
    ),
  ])
  const document = (name, attrs, marks = []) =>
    schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('untouched')),
      schema.nodes[name].create(attrs, null, marks),
    ])
  for (const name of names) {
    const expected = document(name, { source: 'new', raw: 'old fence' })
    const parsed = document(name, { source: 'new', raw: 'new fence' })
    assert.equal(sameRichSourceDocument(parsed, expected, false), false)
    assert.equal(
      sameRichSourceDocument(parsed, expected, true),
      name !== 'customBlock',
    )
    assert.equal(
      sameRichSourceDocument(parsed, document(name, { source: 'new' }), true),
      name !== 'customBlock',
      'newly inserted previews have an empty spelling cache',
    )
    for (const different of [
      document(name, { source: 'other', raw: 'new fence' }),
      document(name, { source: 'new', raw: 'new fence', semantic: 'changed' }),
      document(name, { source: 'new', raw: 'new fence' }, [
        schema.marks.bold.create(),
      ]),
      document(name === 'typstBlock' ? 'mermaidBlock' : 'typstBlock', {
        source: 'new',
        raw: 'new fence',
      }),
      schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text('changed')),
        parsed.lastChild,
      ]),
      schema.nodes.doc.create(null, [parsed.lastChild]),
    ])
      assert.equal(sameRichSourceDocument(different, expected, true), false)
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
