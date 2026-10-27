import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState, Text } from '@codemirror/state'
import { Tree } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
import { formattedTree } from '../src/renderer/src/formatted-contributions.ts'
import { sourceFormatting } from '../src/renderer/src/source-formatting.ts'

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
  // Typing at either end of the text extends it; past the closing delimiter it does not.
  assert.equal(states(view(note, '**bold'), marks).bold, 'pressed ')
  assert.equal(states(view(note, '**bold**'), marks).bold, '')
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

test('formatted unlink removes the link around the caret and leaves other text unedited', () => {
  const linked = view(note, '[li')
  assert.equal(sourceFormatting(linked).run('unlink'), true)
  assert.equal(
    linked.state.doc.toString(),
    note.replace('[link](https://example.com)', 'link'),
  )
  const plain = view(note, 'pl')
  const before = plain.state
  assert.equal(sourceFormatting(plain).run('unlink'), false)
  assert.equal(plain.state, before)
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
    assert.equal(expected.scans, 0)
  }
})
