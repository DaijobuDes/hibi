import assert from 'node:assert/strict'
import test from 'node:test'
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { DocInput } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Tree, TreeCursor } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
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

const grammar = parser.configure(GFM)

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

test('continued code refencing does not rescan the existing span', () => {
  const measure = (length) => {
    const view = typing('', 0, [], grammar.parse(''))
    view.formatting.run('inline-code')
    const input = view.state.facet(EditorView.inputHandler)[0]
    input(view, 0, 0, 'a'.repeat(length), () => null)
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
    assert.equal(view.state.doc.length, length + 6)
    assert.equal(view.state.sliceDoc(0, 2), '``')
    assert.equal(view.state.sliceDoc(view.state.doc.length - 3), 'b``')
    return counts
  }
  assert.deepEqual(measure(32), { text: 0, resolves: 0 })
  assert.deepEqual(measure(1024 * 1024), { text: 0, resolves: 0 })
})
