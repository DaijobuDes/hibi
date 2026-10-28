import assert from 'node:assert/strict'
import test from 'node:test'
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { DocInput } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Tree, TreeCursor } from '@lezer/common'
import { GFM } from '@lezer/markdown'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import {
  formattedLiteral,
  formattedTree,
} from '../src/renderer/src/formatted-contributions.ts'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import { markdownSyntax } from '../src/renderer/src/markdown-syntax.ts'
import { sameRichSourceDocument } from '../src/renderer/src/rich-source-preservation.ts'
import {
  sourceFormatting,
  storedMarkInput,
} from '../src/renderer/src/source-formatting.ts'
import { formattedMarkdownParser } from '../src/shared/formatted-markdown.ts'

const grammar = formattedMarkdownParser(GFM)

function typing(source, anchor, literal = [], tree) {
  const view = {
    composing: false,
    state: EditorState.create({
      doc: source,
      selection: { anchor },
      extensions: [
        history(),
        storedMarkInput,
        ...literal.map((name) => formattedLiteral.of(name)),
        formattedTree.of(
          (state) => tree ?? grammar.parse(new DocInput(state.doc)),
        ),
      ],
    }),
    dispatch(spec) {
      this.state = this.state.update(spec).state
    },
    focus() {},
    type(text) {
      for (const character of text) {
        const { from, to } = this.state.selection.main
        if (
          !this.state
            .facet(EditorView.inputHandler)
            .some((handler) => handler(this, from, to, character, () => null))
        )
          this.dispatch({
            ...this.state.replaceSelection(character),
            userEvent: 'input.type',
          })
      }
      return this.state.doc.toString()
    },
  }
  view.dispatch = view.dispatch.bind(view)
  view.formatting = sourceFormatting(view)
  return view
}

function native(source) {
  const config = markdownConfiguration([
    { id: 'github', markedOptions: { gfm: true } },
  ])
  return new Editor({
    element: null,
    extensions: [
      ...config.core,
      Markdown.configure({
        marked: config.parser,
        markedOptions: config.options,
      }),
      ...config.addons,
    ],
    content: source,
    contentType: 'markdown',
  })
}

function compare(source, from, position, actions, text, literal = []) {
  markdownSyntax.setEnabled('core.escapes', !literal.includes('Escape'))
  const editor = native(source)
  try {
    const view = typing(source, from, literal)
    editor.commands.setTextSelection(position)
    const commands = {
      bold: () => editor.commands.toggleBold(),
      italic: () => editor.commands.toggleItalic(),
      'inline-code': () => editor.commands.toggleCode(),
    }
    for (const id of actions) {
      assert.equal(view.formatting.run(id), commands[id](), id)
      for (const [action, mark] of [
        ['bold', 'bold'],
        ['italic', 'italic'],
        ['inline-code', 'code'],
      ])
        assert.equal(
          view.formatting.inspect().state(action).pressed,
          editor.isActive(mark),
          action,
        )
    }
    editor.view.dispatch(editor.state.tr.insertText(text))
    const actual = view.type(text)
    const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(actual))
    assert.ok(
      sameRichSourceDocument(parsed, editor.state.doc, true),
      JSON.stringify({
        source,
        actions,
        text,
        actual,
        expected: editor.getMarkdown(),
      }),
    )
    assert.equal(undoDepth(view.state), 1)
    assert.equal(undo(view), true)
    assert.equal(view.state.doc.toString(), source)
    assert.equal(redo(view), true)
    assert.equal(view.state.doc.toString(), actual)
    return view
  } finally {
    editor.destroy()
    markdownSyntax.reset()
  }
}

test('stored code excludes existing bold and multiple pending marks', () => {
  compare('a **bold** b', 6, 5, ['inline-code'], 'X')
  compare('a ', 2, 3, ['bold', 'italic', 'inline-code'], 'X')
})

test('turning stored code off enables bold before syntax changes', () => {
  const view = typing('a `code` b', 5)
  view.formatting.run('inline-code')
  assert.equal(view.formatting.inspect().state('bold').disabled, false)
  compare('a `code` b', 5, 5, ['inline-code', 'bold'], 'X')
})

for (const literal of [[], ['Escape']]) {
  for (const text of ['*', '&copy;', '\\*_~=<!', 'x * y &copy;']) {
    test(`stored bold preserves literal ${JSON.stringify(text)} with escapes ${literal.length ? 'off' : 'on'}`, () => {
      compare('a ', 2, 3, ['bold'], text, literal)
    })
  }
}

for (const text of ['a`b', '`a`', 'a``b`c', 'a ` b', '``']) {
  test(`continued stored code refences ${JSON.stringify(text)}`, () => {
    compare('a ', 2, 3, ['inline-code'], text)
  })
}

for (const [source, from, position] of [
  ['a `b`', 4, 4],
  ['a `b`', 5, 4],
  ['a `bc`', 4, 4],
  ['a `` `b ``', 7, 5],
  ['a `` b` ``', 7, 5],
  ['a `  b  `', 7, 6],
  ['a `b``c`', 8, 7],
]) {
  test(`existing code continues at ${from} in ${JSON.stringify(source)}`, () => {
    compare(source, from, position, ['inline-code', 'inline-code'], 'x`y')
  })
}

for (const [source, from, position, text] of [
  ['a ``` b``c ```', 8, 5, '`x'],
  ['a `` `b ``', 6, 4, 'x'],
  ['a ` b`', 5, 5, ' '],
  ['a `   `', 5, 5, 'x'],
  ['a `   `', 5, 5, '`'],
  ['a `b` `c`', 5, 4, 'x`y'],
  ['a `b``c`', 5, 5, 'x'],
  ['a ``b```c``', 6, 5, 'x'],
]) {
  test(`code summary preserves joins and padding: ${JSON.stringify({ source, from, text })}`, () => {
    compare(source, from, position, ['inline-code', 'inline-code'], text)
  })
}

test('ordinary stored bold still types, undoes and redoes', () => {
  compare('a ', 2, 3, ['bold'], 'ordinary text')
  compare('a **bold** b', 8, 7, ['bold', 'bold'], ' more')
})

test('stored mark work is bounded with unrelated text', () => {
  function measure(length) {
    const source = Text.of(['a ', '', '```', 'x'.repeat(length), '```'])
    const tree = grammar.parse(new DocInput(source))
    const view = typing(source, 2, [], tree)
    const counts = { text: 0, resolve: 0, walks: 0 }
    const restore = []
    const patch = (object, key, count) => {
      const own = Object.hasOwn(object, key),
        previous = object[key]
      object[key] = function (...args) {
        const result = previous.apply(this, args)
        count(result)
        return result
      }
      restore.push(() => {
        if (own) object[key] = previous
        else delete object[key]
      })
    }
    for (const proto of new Set([
      Object.getPrototypeOf(Text.of(['x'])),
      Object.getPrototypeOf(Text.of(Array(1000).fill('x'))),
    ])) {
      patch(proto, 'sliceString', (text) => {
        counts.text += text.length
      })
      patch(proto, 'toString', (text) => {
        counts.text += text.length
      })
    }
    patch(Tree.prototype, 'resolveInner', () => {
      counts.resolve++
    })
    patch(Tree.prototype, 'cursor', () => {
      counts.walks++
    })
    patch(Tree.prototype, 'iterate', () => {
      counts.walks++
    })
    patch(TreeCursor.prototype, 'nextSibling', () => {
      counts.walks++
    })
    try {
      assert.equal(view.formatting.run('bold'), true)
      assert.equal(view.formatting.inspect().state('bold').pressed, true)
      assert.equal(
        view.state.facet(EditorView.inputHandler)[0](
          view,
          2,
          2,
          'X',
          () => null,
        ),
        true,
      )
    } finally {
      for (const undo of restore.reverse()) undo()
    }
    return counts
  }
  const small = measure(1),
    large = measure(50 * 1024 * 1024)
  assert.ok(small.text > 0 && small.resolve > 0)
  assert.equal(small.walks, 0)
  assert.deepEqual(large, small)
})

test('cold ordinary code input is bounded before continuation', () => {
  function measure(length) {
    const content = 'a`'.repeat(length / 2) + 'a'
    const source = '``' + content + '``'
    const tree = grammar.parse(source)
    const view = typing(source, 2 + length / 2, [], tree)
    view.formatting.run('inline-code')
    view.formatting.run('inline-code')
    const input = view.state.facet(EditorView.inputHandler)[0]
    const count = (type) => {
      const result = { read: 0, scanned: 0 }
      const proto = Object.getPrototypeOf(view.state.doc)
      const slice = proto.sliceString
      const matchAll = String.prototype.matchAll
      proto.sliceString = function (...args) {
        const value = slice.apply(this, args)
        result.read += value.length
        return value
      }
      String.prototype.matchAll = function (expression) {
        if (expression.source === '`+') result.scanned += this.length
        return matchAll.call(this, expression)
      }
      try {
        for (const text of type) {
          const at = view.state.selection.main.head
          assert.equal(
            input(view, at, at, text, () => null),
            true,
          )
        }
      } finally {
        proto.sliceString = slice
        String.prototype.matchAll = matchAll
      }
      return result
    }
    const cold = count('x')
    const warm = count('`y')
    assert.ok(cold.read <= 16, JSON.stringify({ length, cold }))
    assert.equal(cold.scanned, 1)
    assert.deepEqual(warm, { read: 0, scanned: 2 })
    const typed = view.state.doc.toString()
    assert.equal(
      typed,
      '``' +
        content.slice(0, length / 2) +
        'x`y' +
        content.slice(length / 2) +
        '``',
    )
    assert.equal(undo(view), true)
    assert.equal(view.state.doc.toString(), source)
    assert.equal(redo(view), true)
    assert.equal(view.state.doc.toString(), typed)
    return cold
  }
  const small = measure(32)
  assert.deepEqual(measure(1024 * 1024), small)
  assert.deepEqual(measure(8 * 1024 * 1024), small)
})

test('cold ordinary input preserves fences around long runs and blank code', () => {
  for (const content of [
    'a' + '`'.repeat(1024 * 1024) + 'z',
    ' '.repeat(1024 * 1024),
  ]) {
    const source = '`' + content + '`'
    const at = Math.floor(source.length / 2)
    const view = typing(source, at, [], grammar.parse(source))
    view.formatting.run('inline-code')
    view.formatting.run('inline-code')
    const proto = Object.getPrototypeOf(view.state.doc)
    const slice = proto.sliceString
    let read = 0
    proto.sliceString = function (...args) {
      const value = slice.apply(this, args)
      read += value.length
      return value
    }
    try {
      assert.equal(
        view.state.facet(EditorView.inputHandler)[0](
          view,
          at,
          at,
          'x',
          () => null,
        ),
        true,
      )
    } finally {
      proto.sliceString = slice
    }
    assert.ok(read <= 16, String(read))
    const typed = content.startsWith(' ')
      ? '` ' + source.slice(1, at) + 'x' + source.slice(at, -1) + ' `'
      : source.slice(0, at) + 'x' + source.slice(at)
    assert.equal(view.state.doc.toString(), typed)
    assert.equal(undo(view), true)
    assert.equal(view.state.doc.toString(), source)
    assert.equal(redo(view), true)
    assert.equal(view.state.doc.toString(), typed)
  }
})

for (const placement of ['new', 'end', 'adjacent', 'middle']) {
  test(`continued code refencing does not rescan: ${placement}`, () => {
    const measure = (length) => {
      const source = placement === 'new' ? '' : `\`${'a'.repeat(length)}\``
      const anchor =
        placement === 'new'
          ? 0
          : placement === 'middle'
            ? 1 + length / 2
            : length + (placement === 'adjacent' ? 2 : 1)
      const view = typing(source, anchor, [], grammar.parse(source))
      view.formatting.run('inline-code')
      if (placement !== 'new') view.formatting.run('inline-code')
      const input = view.state.facet(EditorView.inputHandler)[0]
      input(
        view,
        anchor,
        anchor,
        placement === 'new' ? 'a'.repeat(length) : 'x',
        () => null,
      )
      const counts = { text: 0, resolves: 0 }
      const proto = Object.getPrototypeOf(view.state.doc)
      const slice = proto.sliceString
      const resolve = Tree.prototype.resolveInner
      proto.sliceString = function (...args) {
        const text = slice.apply(this, args)
        counts.text += text.length
        return text
      }
      Tree.prototype.resolveInner = function (...args) {
        counts.resolves++
        return resolve.apply(this, args)
      }
      try {
        for (const text of ['`', 'b']) {
          const at = view.state.selection.main.head
          assert.equal(
            input(view, at, at, text, () => null),
            true,
          )
        }
      } finally {
        proto.sliceString = slice
        Tree.prototype.resolveInner = resolve
      }
      assert.equal(
        view.state.doc.length,
        length + (placement === 'new' ? 6 : 7),
      )
      assert.equal(view.state.sliceDoc(0, 2), '``')
      assert.equal(view.state.sliceDoc(view.state.doc.length - 2), '``')
      return counts
    }
    assert.deepEqual(measure(32), { text: 0, resolves: 0 })
    assert.deepEqual(measure(1024 * 1024), { text: 0, resolves: 0 })
  })
}
