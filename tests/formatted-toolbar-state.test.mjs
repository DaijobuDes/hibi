import assert from 'node:assert/strict'
import test from 'node:test'
import { DocInput } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { Tree } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
import { Editor } from '@tiptap/core'
import { Strike } from '@tiptap/extension-strike'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import { NativeTableKit } from '../src/addons/markdown/table-tokenizer.ts'
import {
  subscriptSyntax,
  subtextSyntax,
} from '../src/addons/text-extras/formatted-syntax.ts'
import { Subscript, Subtext } from '../src/addons/text-extras/nodes.ts'
import {
  formattedLiteral,
  formattedTree,
} from '../src/renderer/src/formatted-contributions.ts'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import {
  sourceFormatting,
  tableActions,
} from '../src/renderer/src/source-formatting.ts'
import { ChunkedMarkdownParser } from '../src/shared/chunked-markdown.ts'

const markdown = parser.configure(GFM)
const note = [
  '# Title',
  'plain **bold** *italic* `code` [link](https://example.com) end',
  '- one\n- two\n  - nested',
  '1. first\n2. second',
  '- [ ] task',
  '> quote',
  '```js\nconst x = 1\n```',
  '| a | b |\n| - | - |\n| cell | 2 |',
  '',
].join('\n\n')

/** A formatted view of `doc` with the caret after `text`, `length` characters after it selected, or all of it for null. */
function view(doc, text, length, tree = markdown.parse(doc)) {
  const at = text === null ? 0 : doc.indexOf(text)
  assert.ok(at >= 0, text)
  const anchor =
    text === null ? 0 : at + (length === undefined ? text.length : 0)
  const head = text === null ? doc.length : anchor + (length ?? 0)
  return {
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: formattedTree.of(() => tree),
    }),
    dispatch(spec) {
      this.state = this.state.update(spec).state
    },
    focus() {},
  }
}

/** The pressed and disabled states of `ids`: `pressed`, `disabled`, both or neither. */
function states(target, ids, formatting = sourceFormatting(target)) {
  const inspection = formatting.inspect()
  return Object.fromEntries(
    ids.map((id) => {
      const { pressed, disabled } = inspection.state(id)
      return [id, (pressed ? 'pressed ' : '') + (disabled ? 'disabled' : '')]
    }),
  )
}

const marks = ['bold', 'italic', 'inline-code', 'link', 'unlink']
const blocks = [
  'paragraph',
  'heading-1',
  'bullet-list',
  'numbered-list',
  'checklist',
  'indent',
  'outdent',
  'quote',
  'code-block',
]

test('formatted toolbar marks follow the syntax around the caret, not adjacent delimiters', () => {
  assert.deepEqual(states(view(note, 'plain **bo'), marks), {
    bold: 'pressed ',
    italic: '',
    'inline-code': '',
    link: '',
    unlink: '',
  })
  // Like the rich editor, a caret takes the marks of the text before it,
  // past hidden delimiters: on after bold text, off before it.
  assert.equal(states(view(note, '**bold'), marks).bold, 'pressed ')
  assert.equal(states(view(note, '**bold**'), marks).bold, 'pressed ')
  assert.equal(states(view(note, 'plain **'), marks).bold, '')
  assert.equal(states(view(note, 'plain '), marks).bold, '')
  assert.deepEqual(states(view(note, 'italic', 6), marks).italic, 'pressed ')
  assert.deepEqual(states(view(note, 'plain', 14), marks), {
    bold: '',
    italic: '',
    'inline-code': '',
    link: '',
    unlink: '',
  })
  assert.deepEqual(states(view(note, '`co'), marks), {
    bold: 'disabled',
    italic: 'disabled',
    'inline-code': 'pressed ',
    link: 'disabled',
    unlink: '',
  })
  assert.equal(states(view(note, '[li'), marks).link, 'pressed ')
  // Delimiters the toolbar opened at the caret are pressed until text fills them.
  assert.deepEqual(states(view('plain end****', 'plain end**'), marks), {
    bold: 'pressed ',
    italic: '',
    'inline-code': '',
    link: '',
    unlink: '',
  })
  assert.deepEqual(states(view(note, 'const'), marks), {
    bold: 'disabled',
    italic: 'disabled',
    'inline-code': 'disabled',
    link: 'disabled',
    unlink: '',
  })
})

test('formatted toolbar blocks follow the syntax tree around the selection', () => {
  assert.deepEqual(states(view(note, 'Ti'), blocks), {
    paragraph: '',
    'heading-1': 'pressed ',
    'bullet-list': 'disabled',
    'numbered-list': 'disabled',
    checklist: 'disabled',
    indent: 'disabled',
    outdent: 'disabled',
    quote: '',
    'code-block': '',
  })
  assert.deepEqual(states(view(note, 'pl'), blocks), {
    paragraph: 'pressed disabled',
    'heading-1': '',
    'bullet-list': '',
    'numbered-list': '',
    checklist: '',
    indent: 'disabled',
    outdent: 'disabled',
    quote: '',
    'code-block': '',
  })
  const item = {
    paragraph: 'pressed disabled',
    'heading-1': 'disabled',
    'bullet-list': 'pressed ',
    'numbered-list': '',
    checklist: '',
    indent: 'disabled',
    outdent: '',
    quote: 'disabled',
    'code-block': 'disabled',
  }
  assert.deepEqual(states(view(note, 'on'), blocks), item)
  assert.deepEqual(states(view(note, 'tw'), blocks), { ...item, indent: '' })
  assert.deepEqual(states(view(note, 'nes'), blocks), item)
  assert.deepEqual(states(view(note, 'sec'), blocks), {
    ...item,
    'bullet-list': '',
    'numbered-list': 'pressed ',
    indent: '',
  })
  assert.deepEqual(states(view(note, 'tas'), blocks), {
    ...item,
    'bullet-list': '',
    checklist: 'pressed ',
  })
  assert.deepEqual(states(view(note, 'quo'), blocks), {
    paragraph: 'pressed disabled',
    'heading-1': '',
    'bullet-list': '',
    'numbered-list': '',
    checklist: '',
    indent: 'disabled',
    outdent: 'disabled',
    quote: 'pressed ',
    'code-block': '',
  })
  assert.deepEqual(states(view(note, 'const'), blocks), {
    paragraph: '',
    'heading-1': '',
    'bullet-list': 'disabled',
    'numbered-list': 'disabled',
    checklist: 'disabled',
    indent: 'disabled',
    outdent: 'disabled',
    quote: '',
    'code-block': 'pressed ',
  })
  assert.equal(states(view(note, 'ce'), blocks).paragraph, 'pressed disabled')
  // A caret at a line's end, or between blocks, reads the block it types into.
  assert.equal(states(view(note, '# Title'), blocks)['heading-1'], 'pressed ')
  assert.equal(states(view(note, 'one'), blocks)['bullet-list'], 'pressed ')
  assert.equal(
    states(view(note, '# Title\n'), blocks).paragraph,
    'pressed disabled',
  )
  assert.deepEqual(states(view(note, null), blocks), {
    paragraph: '',
    'heading-1': '',
    'bullet-list': 'disabled',
    'numbered-list': 'disabled',
    checklist: 'disabled',
    indent: 'disabled',
    outdent: 'disabled',
    quote: '',
    'code-block': '',
  })
})

/** The source after running `id` on a formatted view of `doc` with the caret after `text`, or null when it changes nothing. */
function ran(id, doc, text, length) {
  const target = view(doc, text, length)
  const before = target.state
  const done = sourceFormatting(target).run(id)
  if (!done) assert.equal(target.state, before)
  return done ? target.state.doc.toString() : null
}

test('formatted unlink removes links by their syntax and leaves other text unedited', () => {
  assert.equal(
    ran('unlink', note, '[li'),
    note.replace('[link](https://example.com)', 'link'),
  )
  // As the rich editor writes them: balanced destinations, escaped labels, autolinks and references.
  assert.equal(ran('unlink', '[x](https://example.com/a(b))', '[x'), 'x')
  assert.equal(ran('unlink', '[a\\]b](https://example.com)', '[a'), 'a\\]b')
  assert.equal(
    ran('unlink', '<https://example.com>', '<http'),
    'https://example.com',
  )
  assert.equal(
    ran('unlink', '[a][r]\n\n[r]: https://e.test', '[a'),
    'a\n\n[r]: https://e.test',
  )
  assert.equal(ran('unlink', 'a [b](u) c [d](v) e', 'a', 13), 'a b c d e')
  // Nothing to unlink leaves the note unedited.
  assert.equal(ran('unlink', note, 'pl'), null)
})

test('the pressed code block action turns fenced code back into text', () => {
  assert.equal(ran('code-block', '```js\ncodeA\n```', 'co'), 'codeA')
  assert.equal(ran('code-block', '> ```\n> a\n> b\n> ```', '> a'), '> a\n> b')
  assert.equal(ran('code-block', '- ```\n  a\n  ```', '  a'), '- a')
})

test('the code block action at a caret makes its paragraph code', {
  todo: 'formatted gap input-075: the code block action at a caret turns its paragraph into code',
}, () => {
  assert.equal(ran('code-block', 'a', 'a'), '```\na\n```')
})

test('formatted toolbar states match the reviewed rich editor outcomes', () => {
  const at = (doc, anchor, head = anchor, extensions = []) =>
    sourceFormatting({
      state: EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [
          formattedTree.of(() => markdown.parse(doc)),
          ...extensions,
        ],
      }),
    }).inspect()
  const state = (inspection, id) => {
    const { pressed, disabled } = inspection.state(id)
    return { pressed, disabled }
  }
  // An interior heading is not a paragraph, and a list can wrap from the first paragraph.
  const mixed = at('aa\n\n# mid\n\nzz', 1, 12)
  assert.deepEqual(state(mixed, 'paragraph'), {
    pressed: false,
    disabled: false,
  })
  assert.deepEqual(state(mixed, 'bullet-list'), {
    pressed: false,
    disabled: false,
  })
  // Marks hold over all of a range's text, across blocks.
  assert.deepEqual(state(at('**aa**\n\n**zz**', 3, 11), 'bold'), {
    pressed: true,
    disabled: false,
  })
  assert.equal(at('preA **boldB** postC', 7).state('bold').pressed, false)
  assert.equal(
    at('preA https://example.com postB', 10).state('link').pressed,
    true,
  )
  // Delimiters in code are its text.
  for (const [doc, caret] of [
    ['````\n****\n````', 6],
    ['`****`', 3],
  ])
    assert.deepEqual(state(at(doc, caret), 'bold'), {
      pressed: false,
      disabled: true,
    })
  // A disabled syntax feature has no action.
  assert.deepEqual(
    state(
      at('preA **boldB** postC', 9, 9, [formattedLiteral.of('StrongEmphasis')]),
      'bold',
    ),
    { pressed: false, disabled: true },
  )
})

/** A seeded generator from the high bits of a 32-bit LCG. */
function random(seed) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) / 0x1000000
  }
}

test('formatted toolbar states match the rich toolbar on random selections', () => {
  const flavors = [
    {
      id: 'github',
      markedOptions: { gfm: true },
      richExtensions: [
        Strike,
        NativeTableKit.configure({ table: { resizable: false } }),
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
    },
    { id: 'text-extras', richExtensions: [Subscript, Subtext] },
  ]
  const grammar = parser.configure([GFM, subscriptSyntax, subtextSyntax])
  // FormattingToolbar's rich checks.
  const list = (editor) =>
    editor.isActive('taskList') ? 'taskItem' : 'listItem'
  const actions = [
    ['bold', 'bold', (c) => c.toggleBold()],
    ['italic', 'italic', (c) => c.toggleItalic()],
    ['strike', 'strike', (c) => c.toggleStrike()],
    ['inline-code', 'code', (c) => c.toggleCode()],
    ['subscript', 'subscript', (c) => c.toggleMark('subscript')],
    ['subtext', 'subtext', (c) => c.setNode('subtext')],
    ['paragraph', 'paragraph', (c) => c.setParagraph()],
    ...[1, 2, 3, 4, 5, 6].map((level) => [
      `heading-${level}`,
      'heading',
      (c) => c.toggleHeading({ level }),
      { level },
    ]),
    ['bullet-list', 'bulletList', (c) => c.toggleBulletList()],
    ['numbered-list', 'orderedList', (c) => c.toggleOrderedList()],
    ['checklist', 'taskList', (c) => c.toggleTaskList()],
    ['indent', null, (c, editor) => c.sinkListItem(list(editor))],
    ['outdent', null, (c, editor) => c.liftListItem(list(editor))],
    ['quote', 'blockquote', (c) => c.toggleBlockquote()],
    ['code-block', 'codeBlock', (c) => c.toggleCodeBlock()],
    ['hard-break', null, (c) => c.setHardBreak()],
    ['link', 'link', (c) => c.setLink({ href: 'https://example.com' })],
    ['unlink', null, (c) => c.unsetLink()],
  ]
  // accepted difference input-071: block actions stay disabled while the
  // selection's head is in a table cell.
  const cellBlocks = [
    'paragraph',
    'subtext',
    ...[1, 2, 3, 4, 5, 6].map((level) => `heading-${level}`),
    'bullet-list',
    'numbered-list',
    'checklist',
    'indent',
    'outdent',
    'quote',
    'code-block',
  ]
  const documents = [
    'plainA\n\n# headingB\n\nplainC',
    '**boldA**\n\n**boldB**',
    'preA **boldB** postC',
    '**outerA *innerB* tailC**',
    'preA [linkB](https://example.com) postC',
    'preA https://example.com postB',
    '- itemA\n- itemB\n  - itemC\n\nplainD',
    '- itemA\n\n  itemB\n- itemC',
    '> quoteA\n>\n> # headingB\n>\n> quoteC\n\nplainD',
    '```js\ncodeA\n```\n\nplainB\n\n```\ncodeC\n```',
    '# headingA\n\n## headingB\n\n###### headingC',
    '**boldA** `codeB` **boldC**',
    'preA ~~strikeB~~ postC',
    'preA ~subscriptB~ postC',
    '-# smallA\n\nplainB',
    '- [ ] taskA\n- [x] taskB\n  - [ ] taskC\n\nplainD',
    '| headerA | headerB |\n| --- | --- |\n| cellC | cellD |',
    note,
  ]
  const mismatches = []
  let comparisons = 0
  for (const seed of [0x552c0ffe, 0x552a11ce]) {
    const next = random(seed)
    for (const input of documents) {
      const { core, addons, parser, options } = markdownConfiguration(flavors)
      const editor = new Editor({
        element: null,
        extensions: [
          ...core,
          Markdown.configure({ marked: parser, markedOptions: options }),
          ...addons,
        ],
        content: input,
        contentType: 'markdown',
      })
      // The rich editor's source and each text's position in both editors.
      const source = editor.getMarkdown()
      const tree = grammar.parse(source)
      const points = []
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return
        const at = source.indexOf(node.text)
        if (at < 0 || source.indexOf(node.text, at + 1) >= 0) return
        for (const offset of new Set([
          0,
          1,
          Math.floor(node.text.length / 2),
          node.text.length,
        ]))
          points.push({ rich: pos + offset, formatted: at + offset })
      })
      const table = (view) => {
        for (
          let node = tree.resolveInner(view.state.selection.main.head, 1);
          node;
          node = node.parent
        )
          if (node.name === 'Table') return true
        return false
      }
      for (let round = 0; round < 40; round++) {
        const a = points[Math.floor(next() * points.length)]
        const b = next() < 0.4 ? a : points[Math.floor(next() * points.length)]
        editor.commands.setTextSelection({
          from: Math.min(a.rich, b.rich),
          to: Math.max(a.rich, b.rich),
        })
        const target = {
          state: EditorState.create({
            doc: source,
            selection: {
              anchor: Math.min(a.formatted, b.formatted),
              head: Math.max(a.formatted, b.formatted),
            },
            extensions: [
              formattedTree.of(() => tree),
              tableActions.of({ active: table, run: () => false }),
            ],
          }),
        }
        const inspection = sourceFormatting(target).inspect()
        const inCell = table(target)
        for (const [id, active, command, attrs] of actions) {
          let allowed = false
          try {
            allowed = command(editor.can().chain(), editor).run()
          } catch {}
          const expected = {
            pressed: active ? editor.isActive(active, attrs) : false,
            disabled: !allowed || (inCell && cellBlocks.includes(id)),
          }
          const { pressed, disabled } = inspection.state(id)
          comparisons++
          if (pressed !== expected.pressed || disabled !== expected.disabled)
            mismatches.push({
              source,
              selection: target.state.selection.main,
              id,
              expected,
            })
        }
      }
      editor.destroy()
    }
  }
  assert.ok(comparisons > 30000)
  assert.deepEqual(mismatches.slice(0, 5), [])
})

/** Syntax tree steps: node and cursor moves between parents, children and siblings. */
function treeSteps(tree, run) {
  let steps = 0
  const restore = []
  const count = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    if (!descriptor) return
    const wrapped = descriptor.get
      ? {
          ...descriptor,
          get() {
            steps++
            return descriptor.get.call(this)
          },
        }
      : {
          ...descriptor,
          value(...args) {
            steps++
            return descriptor.value.apply(this, args)
          },
        }
    Object.defineProperty(prototype, name, wrapped)
    restore.push(() => Object.defineProperty(prototype, name, descriptor))
  }
  for (const name of [
    'firstChild',
    'lastChild',
    'nextSibling',
    'prevSibling',
    'parent',
    'next',
    'prev',
    'enter',
    'childAfter',
    'childBefore',
    'moveTo',
  ])
    count(Object.getPrototypeOf(tree.cursor()), name)
  const nodes = new Set([
    Object.getPrototypeOf(tree.topNode),
    Object.getPrototypeOf(tree.resolveInner(3, 1)),
  ])
  for (const prototype of nodes)
    for (const name of [
      'firstChild',
      'lastChild',
      'nextSibling',
      'prevSibling',
      'parent',
      'childAfter',
      'childBefore',
      'getChild',
      'getChildren',
      'enter',
    ])
      count(prototype, name)
  try {
    run()
  } finally {
    for (const undo of restore) undo()
  }
  return steps
}

for (const [name, parse] of [
  ['lezer', (doc) => markdown.parse(doc)],
  [
    'chunked',
    (doc) =>
      new ChunkedMarkdownParser(markdown, markdown, {
        opaque: new Set(['FencedCode', 'CodeBlock']),
      }).parse(new DocInput(Text.of(doc.split('\n')))),
  ],
])
  test(`formatted toolbar inspection walks a bounded part of the ${name} syntax tree`, () => {
    const ids = [...marks, ...blocks, 'subtext', 'strike', 'subscript']
    const steps = (doc, anchor, head = anchor) => {
      const tree = parse(doc)
      const target = {
        state: EditorState.create({
          doc,
          selection: { anchor, head },
          extensions: formattedTree.of(() => tree),
        }),
      }
      const formatting = sourceFormatting(target)
      return treeSteps(tree, () => states(target, ids, formatting))
    }
    // A caret at the end of a link's text finds its `]` from the link's end, not by reading its text.
    const link = (spans) => {
      const doc = `pre [${'**b** '.repeat(spans)}xy](https://e.test) post`
      return steps(doc, doc.indexOf('xy') + 1)
    }
    assert.equal(link(32768), link(512))
    assert.ok(link(32768) < 64)
    // A caret, or a range of three items, in a list of 200,000 items: a
    // balanced tree adds a few steps for each tenfold growth, not one per item.
    const items = (count) => {
      const doc = `${Array.from({ length: count }, (_, i) => `- item${i}`).join('\n')}\n`
      const from = doc.indexOf('item10') + 2
      return {
        caret: steps(doc, from),
        range: steps(doc, from, doc.indexOf('item13') + 3),
      }
    }
    const small = items(20),
      large = items(200000)
    assert.equal(large.caret, small.caret)
    assert.ok(large.range - small.range < 64, `${small.range} ${large.range}`)
  })

/** Characters read from documents and syntax tree lookups while `run` inspects. */
function counted(run) {
  const reads = { chars: 0, resolves: 0, scans: 0 }
  const restore = []
  const patch = (target, name, count) => {
    const original = target[name]
    target[name] = function (...args) {
      const result = original.apply(this, args)
      count(result)
      return result
    }
    restore.push(() => {
      target[name] = original
    })
  }
  const leaf = Object.getPrototypeOf(Text.of(['a']))
  const node = Object.getPrototypeOf(Text.of(Array(1000).fill('a')))
  for (const prototype of new Set([leaf, node])) {
    patch(prototype, 'sliceString', (text) => {
      reads.chars += text.length
    })
  }
  patch(Object.getPrototypeOf(leaf), 'lineAt', (line) => {
    reads.chars += line.length
  })
  patch(Tree.prototype, 'resolveInner', () => reads.resolves++)
  for (const name of ['iterate', 'cursor', 'cursorAt'])
    patch(Tree.prototype, name, () => reads.scans++)
  try {
    run()
  } finally {
    for (const undo of restore) undo()
  }
  return reads
}

test('formatted toolbar inspection reads the same text and syntax in a 50 MiB note as in a small one', () => {
  const ids = [...marks, ...blocks, 'subtext', 'strike', 'subscript']
  const code = (line) => `${note}\`\`\`\n${line}\n\`\`\`\n`
  const small = code('x')
  const large = code('x'.repeat(50 * 1024 * 1024))
  const trees = new Map([small, large].map((doc) => [doc, markdown.parse(doc)]))
  for (const [text, length] of [
    ['plain **bo'],
    ['[li'],
    ['tw'],
    ['plain', 14],
    // A caret in the last line, which is giant in the large note.
    ['```\nx'],
    [null],
  ]) {
    const inspect = (doc) => {
      const target = view(doc, text, length, trees.get(doc))
      const formatting = sourceFormatting(target)
      return counted(() => states(target, ids, formatting))
    }
    const expected = inspect(small)
    assert.deepEqual(inspect(large), expected, String(text))
    // A caret walks up from its position; only a range reads its syntax in order.
    if (length === undefined && text !== null) assert.equal(expected.scans, 0)
  }
})
