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
import { markdownSerializer } from '../src/renderer/src/markdown-serialization.ts'
import { markdownSyntax } from '../src/renderer/src/markdown-syntax.ts'
import {
  preserveRichSource,
  sameRichSourceDocument,
} from '../src/renderer/src/rich-source-preservation.ts'
import {
  sourceFormatting,
  storedMarkInput,
} from '../src/renderer/src/source-formatting.ts'
import { inlineInput } from '../src/renderer/src/source-formatting-actions.ts'
import { formattedMarkdownParser } from '../src/shared/formatted-markdown.ts'
import { RenderedTextIndex } from '../src/shared/rendered-text.ts'
import { SourceStore } from '../src/shared/source-buffer.ts'
import { renderedConfig } from './rendered-config.mjs'

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

test('inline replacement at consumed markers preserves surviving wrappers and exact history', () => {
  for (const [source, from, to, expected, nativeFrom, nativeTo] of [
    ['c _ell_', 0, 3, '_ell_', 1, 3],
    ['c __ell__', 0, 4, '__ell__', 1, 3],
    ['_cell_ x', 5, 8, '_cell_', 5, 7],
    ['__cell__ x', 6, 10, '__cell__', 5, 7],
    ['c ``ell``', 0, 4, '``ell``', 1, 3],
    ['c `` ell ``', 0, 4, '`` ell ``', 1, 3],
    ['c ``  ell  ``', 0, 4, '``  ell  ``', 1, 3],
  ])
    for (const reverse of [false, true]) {
      const editor = native(source)
      try {
        const serialize = markdownSerializer(editor.markdown, true)
        const before = serialize(editor.state.doc).source
        editor.commands.setTextSelection({ from: nativeFrom, to: nativeTo })
        editor.view.dispatch(editor.state.tr.deleteSelection())
        const preserved = preserveRichSource(
          source,
          before,
          serialize(editor.state.doc).source,
          (candidate) =>
            sameRichSourceDocument(
              editor.schema.nodeFromJSON(editor.markdown.parse(candidate)),
              editor.state.doc,
              true,
            ),
        )
        assert.equal(preserved, expected)
        const view = typing(source, from)
        view.dispatch({
          selection: { anchor: reverse ? to : from, head: reverse ? from : to },
        })
        assert.equal(
          view.state
            .facet(EditorView.inputHandler)
            .some((input) => input(view, from, to, '', () => null)),
          true,
        )
        assert.equal(view.state.doc.toString(), preserved)
        assert.deepEqual(
          editor.schema
            .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
            .toJSON(),
          editor.getJSON(),
        )
        assert.equal(undo(view), true)
        assert.equal(view.state.doc.toString(), source)
        assert.equal(redo(view), true)
        assert.equal(view.state.doc.toString(), preserved)
      } finally {
        editor.destroy()
      }
    }
})

test('inline input declines safe adjacent ranges with bounded glyph reads', () => {
  for (const [source, from, to, literal, text, expectedRead] of [
    ['c*' + 'e'.repeat(64) + '*', 0, 1, [], 'Z', 1],
    ['c*' + 'e'.repeat(64 * 1024) + '*', 0, 1, [], 'Z', 1],
    ['*cell*x', 6, 7, [], 'Z', 1],
    ['c*ell*', 0, 2, ['Emphasis'], 'Z', 0],
    ['*cell*x', 5, 7, ['Emphasis'], 'Z', 0],
    ['plain text', 1, 2, [], 'Z', 0],
    ['c _' + 'e'.repeat(64) + '_', 0, 2, [], '?', 5],
    ['c _' + 'e'.repeat(64 * 1024) + '_', 0, 2, [], '?', 5],
  ]) {
    const view = typing(source, from, literal)
    view.dispatch({ selection: { anchor: from, head: to } })
    const tree = grammar.parse(source)
    let read = 0
    const slice = view.state.sliceDoc.bind(view.state)
    view.state.sliceDoc = (from, to) => {
      const text = slice(from, to)
      read += text.length
      return text
    }
    assert.equal(inlineInput(view.state, tree, from, to, text), null)
    assert.equal(read, expectedRead)
    assert.equal(view.state.doc.toString(), source)
  }
})

test('all-space code retains its complete candidate model when the native source codec declines', () => {
  const source = 'c ``   ``'
  const editor = native(source)
  try {
    const serialize = markdownSerializer(editor.markdown, true)
    const before = serialize(editor.state.doc).source
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.view.dispatch(editor.state.tr.deleteSelection())
    const after = serialize(editor.state.doc).source
    assert.equal(before, 'c    ')
    assert.equal(after, '')
    assert.equal(
      preserveRichSource(source, before, after, (candidate) =>
        sameRichSourceDocument(
          editor.schema.nodeFromJSON(editor.markdown.parse(candidate)),
          editor.state.doc,
          true,
        ),
      ),
      null,
    )
    const view = typing(source, 0)
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    assert.equal(
      view.state
        .facet(EditorView.inputHandler)
        .some((input) => input(view, 0, 4, '', () => null)),
      true,
    )
    assert.equal(view.state.doc.toString(), '``   ``')
    assert.deepEqual(
      editor.schema
        .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
        .toJSON(),
      editor.getJSON(),
    )
    assert.equal(view.state.selection.main.head, 0)
    assert.equal(undo(view), true)
    assert.equal(view.state.doc.toString(), source)
    assert.equal(redo(view), true)
    assert.equal(view.state.doc.toString(), '``   ``')
  } finally {
    editor.destroy()
  }
})

test('consumed underscore wrappers keep the full marked candidate through plain replacement and next input', () => {
  for (const [source, from, to, expected, next, nativeFrom, nativeTo] of [
    ['c _ell_', 0, 3, 'Z*ell*', 'ZQ*ell*', 1, 3],
    ['c __ell__', 0, 4, 'Z**ell**', 'ZQ**ell**', 1, 3],
    ['_cell_ x', 5, 8, '*cell*Z', '*cell*ZQ', 5, 7],
    ['__cell__ x', 6, 10, '**cell**Z', '**cell**ZQ', 5, 7],
  ])
    for (const reverse of [false, true]) {
      const editor = native(source)
      try {
        editor.commands.setTextSelection({ from: nativeFrom, to: nativeTo })
        editor.view.dispatch(editor.state.tr.insertText('Z'))
        const view = typing(source, from)
        view.dispatch({
          selection: { anchor: reverse ? to : from, head: reverse ? from : to },
        })
        assert.equal(
          view.state
            .facet(EditorView.inputHandler)
            .some((input) => input(view, from, to, 'Z', () => null)),
          true,
        )
        assert.deepEqual(
          editor.schema
            .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
            .toJSON(),
          editor.getJSON(),
        )
        assert.equal(view.state.doc.toString(), expected)
        editor.view.dispatch(editor.state.tr.insertText('Q'))
        assert.equal(view.type('Q'), next)
        assert.deepEqual(
          editor.schema
            .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
            .toJSON(),
          editor.getJSON(),
        )
      } finally {
        editor.destroy()
      }
    }
})

test('a plain next glyph before a retained underscore wrapper keeps its full marked candidate', () => {
  const source = 'c _ell_'
  const editor = native(source)
  try {
    const serialize = markdownSerializer(editor.markdown, true)
    const before = serialize(editor.state.doc).source
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.view.dispatch(editor.state.tr.insertText('?'))
    const preserved = preserveRichSource(
      source,
      before,
      serialize(editor.state.doc).source,
      (candidate) =>
        sameRichSourceDocument(
          editor.schema.nodeFromJSON(editor.markdown.parse(candidate)),
          editor.state.doc,
          true,
        ),
    )
    assert.equal(preserved, '?_ell_')
    const view = typing(source, 0)
    view.dispatch({ selection: { anchor: 0, head: 3 } })
    assert.equal(
      view.state
        .facet(EditorView.inputHandler)
        .some((input) => input(view, 0, 3, '?', () => null)),
      true,
    )
    assert.equal(view.state.doc.toString(), preserved)
    assert.equal(view.state.selection.main.head, 1)
    editor.view.dispatch(editor.state.tr.insertText('Q'))
    view.type('Q')
    assert.deepEqual(
      editor.schema
        .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
        .toJSON(),
      editor.getJSON(),
    )
    assert.equal(view.state.doc.toString(), '?Q*ell*')
  } finally {
    editor.destroy()
  }
})

test('adjacent underscore boundaries keep their marked candidate when replacement removes whitespace', () => {
  for (const [source, from, to, expected, nativeFrom, nativeTo] of [
    ['x _ell_', 0, 2, 'Z*ell*', 1, 3],
    ['_cell_ x', 6, 8, '*cell*Z', 5, 7],
  ]) {
    const editor = native(source)
    try {
      editor.commands.setTextSelection({ from: nativeFrom, to: nativeTo })
      editor.view.dispatch(editor.state.tr.insertText('Z'))
      const view = typing(source, from)
      view.dispatch({ selection: { anchor: from, head: to } })
      view.type('Z')
      assert.deepEqual(
        editor.schema
          .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
          .toJSON(),
        editor.getJSON(),
      )
      assert.equal(view.state.doc.toString(), expected)
    } finally {
      editor.destroy()
    }
  }
})

test('pending inline marks keep input priority at unsafe underscore boundaries', () => {
  for (const action of ['bold', 'italic']) {
    const source = '?_ell_'
    const editor = native(source)
    try {
      editor.commands.setTextSelection(2)
      if (action === 'bold') editor.commands.toggleBold()
      else editor.commands.toggleItalic()
      editor.view.dispatch(editor.state.tr.insertText('Q'))
      const view = typing(source, 1)
      assert.equal(view.formatting.run(action), true)
      assert.equal(view.state.doc.toString(), source)
      assert.equal(view.formatting.inspect().state(action).pressed, true)
      view.type('Q')
      assert.deepEqual(
        editor.schema
          .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
          .toJSON(),
        editor.getJSON(),
      )
    } finally {
      editor.destroy()
    }
  }
})

test('literal entity facet keeps inserted edge references visible in formatted text', () => {
  const source = '&#90;_[ell](https://e.test)_'
  for (const literal of [[], ['Entity']]) {
    const state = EditorState.create({
      doc: source,
      extensions: literal.map((name) => formattedLiteral.of(name)),
    })
    const store = new SourceStore(source, {
      tabId: 'literal-edge',
      revision: 0,
    })
    const index = new RenderedTextIndex(store.snapshot(), 0, {
      ...renderedConfig,
      literal: state.facet(formattedLiteral),
    })
    for (const _step of index.build()) {
    }
    const visible = [...index.range(0, index.length)]
      .map((run) => run.text ?? index.text(run.from, run.to))
      .join('')
    assert.equal(visible, literal.length ? '&#90;ell' : 'Zell')
  }
})

test('both opaque input edges encode each Unicode scalar once', () => {
  const left = '_[ell](https://e.test)_',
    right = '_`ell`_',
    source = left + ' c ' + right,
    text = '𐐀X',
    expected = left + '&#66560;&#88;' + right
  const editor = native(source)
  try {
    editor.commands.setTextSelection({ from: 4, to: 7 })
    editor.view.dispatch(editor.state.tr.insertText(text))
    const view = typing(source, left.length)
    view.dispatch({ selection: { anchor: left.length, head: left.length + 3 } })
    assert.equal(
      view.state
        .facet(EditorView.inputHandler)
        .some((input) =>
          input(view, left.length, left.length + 3, text, () => null),
        ),
      true,
    )
    assert.equal(view.state.doc.toString(), expected)
    assert.equal(
      view.state.selection.main.head,
      left.length + '&#66560;&#88;'.length,
    )
    assert.deepEqual(
      editor.schema.nodeFromJSON(editor.markdown.parse(expected)).toJSON(),
      editor.getJSON(),
    )
  } finally {
    editor.destroy()
  }
})

for (const body of ['[ell](https://e.test)', '`ell`']) {
  for (const leading of [true, false]) {
    test(`replacement beside retained opaque content keeps typed edge and next glyph: ${body}, leading=${leading}`, (t) => {
      for (const reverse of [false, true]) {
        const source = leading ? 'c _' + body + '_' : '_' + body + '_ x'
        const from = leading ? 0 : source.length - 3,
          to = leading ? 3 : source.length
        const editor = native(source)
        try {
          const serialize = markdownSerializer(editor.markdown, true)
          const before = serialize(editor.state.doc).source
          editor.commands.setTextSelection({
            from: leading ? 1 : 4,
            to: leading ? 3 : 6,
          })
          editor.view.dispatch(editor.state.tr.insertText('Z'))
          const after = serialize(editor.state.doc).source
          const preserved = preserveRichSource(
            source,
            before,
            after,
            (candidate) =>
              sameRichSourceDocument(
                editor.schema.nodeFromJSON(editor.markdown.parse(candidate)),
                editor.state.doc,
                true,
              ),
          )
          if (leading) assert.equal(preserved, null)
          const view = typing(source, from)
          view.dispatch({
            selection: {
              anchor: reverse ? to : from,
              head: reverse ? from : to,
            },
          })
          const dispatch = view.dispatch,
            events = []
          view.dispatch = (spec) => {
            events.push(spec.userEvent)
            dispatch(spec)
          }
          const expected = leading
            ? '&#90;_' + body + '_'
            : '_' + body + '_&#90;'
          view.type('Z')
          t.diagnostic(
            JSON.stringify({
              source,
              reverse,
              before,
              after,
              preserved,
              actual: view.state.doc.toString(),
              candidate: editor.getJSON(),
            }),
          )
          assert.equal(view.state.doc.toString(), expected)
          assert.equal(
            view.state.selection.main.head,
            leading ? 5 : expected.length,
          )
          assert.deepEqual(events, ['input.type'])
          assert.deepEqual(
            editor.schema
              .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
              .toJSON(),
            editor.getJSON(),
          )
          editor.view.dispatch(editor.state.tr.insertText('Q'))
          view.type('Q')
          const next = leading ? '&#90;&#81;_' + body + '_' : expected + 'Q'
          assert.equal(view.state.doc.toString(), next)
          assert.equal(
            view.state.selection.main.head,
            leading ? 10 : next.length,
          )
          assert.deepEqual(events, ['input.type', 'input.type'])
          assert.deepEqual(
            editor.schema
              .nodeFromJSON(editor.markdown.parse(view.state.doc.toString()))
              .toJSON(),
            editor.getJSON(),
          )
        } finally {
          editor.destroy()
        }
      }
    })
  }
}
