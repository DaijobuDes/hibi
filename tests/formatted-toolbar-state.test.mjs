import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Tree } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
import { formattedTree } from '../src/renderer/src/formatted-contributions.ts'
import {
  sourceFormatting,
  storedMarkInput,
} from '../src/renderer/src/source-formatting.ts'

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

/** A formatted view of `doc`, with stored marks, that types like CodeMirror's input. */
function typing(doc, anchor) {
  const target = {
    composing: false,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        formattedTree.of((state) => markdown.parse(state.doc.toString())),
        storedMarkInput,
      ],
    }),
    dispatch(spec) {
      this.state = this.state.update(spec).state
    },
    focus() {},
    type(text) {
      for (const character of text) {
        const { from, to } = this.state.selection.main
        const insert = () =>
          this.state.update(this.state.replaceSelection(character))
        if (
          !this.state
            .facet(EditorView.inputHandler)
            .some((handler) => handler(this, from, to, character, insert))
        )
          this.state = insert().state
      }
      return this.state.doc.toString()
    },
  }
  target.formatting = sourceFormatting(target)
  target.pressed = (id) => target.formatting.inspect().state(id).pressed
  return target
}

test('a formatted caret action stores its mark for the text typed next', () => {
  const view = typing('plain end', 9)
  assert.equal(view.formatting.run('bold'), true)
  assert.equal(view.state.doc.toString(), 'plain end')
  assert.equal(view.pressed('bold'), true)
  assert.equal(view.type(' typed'), 'plain end **typed**')
  assert.equal(view.pressed('bold'), true)
  assert.equal(view.type(' more'), 'plain end **typed more**')

  const off = typing('a **bold** b', 6)
  off.formatting.run('bold')
  assert.equal(off.pressed('bold'), false)
  assert.equal(off.type('X'), 'a **bo**X**ld** b')
  assert.equal(off.pressed('bold'), false)
  const end = typing('a **bold** b', 8)
  end.formatting.run('bold')
  assert.equal(end.type('X'), 'a **bold**X b')

  // Typing next to the same formatting extends it.
  const joined = typing('a **bold** b', 10)
  assert.equal(joined.pressed('bold'), false)
  joined.formatting.run('bold')
  assert.equal(joined.type('er'), 'a **bolder** b')
  // Two marks open together, and a gap line between blocks becomes a paragraph.
  const gap = typing('a\n\nb', 2)
  gap.formatting.run('bold')
  gap.formatting.run('italic')
  assert.equal(gap.pressed('italic'), true)
  assert.equal(gap.type('x'), 'a\n\n***x***\n\nb')
  assert.equal(gap.type('y'), 'a\n\n***xy***\n\nb')
  const code = typing('a ', 2)
  code.formatting.run('inline-code')
  assert.equal(code.pressed('bold'), false)
  assert.equal(code.formatting.inspect().state('bold').disabled, true)
  assert.equal(code.type('x'), 'a `x`')
})

test('stored marks drop when the caret moves or the text has lines', () => {
  const moved = typing('plain end', 9)
  moved.formatting.run('bold')
  moved.dispatch({ selection: { anchor: 3 } })
  moved.dispatch({ selection: { anchor: 9 } })
  assert.equal(moved.pressed('bold'), false)
  assert.equal(moved.type('x'), 'plain endx')
  // Like the rich editor, multi-line input does not take the caret's stored marks.
  const lines = typing('', 0)
  lines.formatting.run('bold')
  const { from, to } = lines.state.selection.main
  assert.equal(
    lines.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(lines, from, to, 'alpha\nbeta', () => null)),
    false,
  )
})
