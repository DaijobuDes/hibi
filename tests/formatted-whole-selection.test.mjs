import assert from 'node:assert/strict'
import test from 'node:test'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  formattedDocument,
  formattedPrefix,
} from '../src/renderer/src/formatted-contributions.ts'

let keypress
const original = EditorView.domEventHandlers
let wholeSelectionInput
try {
  EditorView.domEventHandlers = (handlers) => {
    if (handlers.keypress) keypress = handlers.keypress
    return original.call(EditorView, handlers)
  }
  ;({ wholeSelectionInput } = await import(
    '../src/renderer/src/source-formatting.ts'
  ))
} finally {
  EditorView.domEventHandlers = original
}

const document = new Compartment()
const source = '```\nalpha\n```\n\n```\nplain bold\n```'
function fixture(extensions = [], prefix = '') {
  const view = {
    contentDOM: {},
    hasFocus: true,
    composing: false,
    compositionStarted: false,
    commits: 0,
    state: EditorState.create({
      doc: prefix + source,
      selection: { anchor: prefix.length, head: prefix.length + source.length },
      extensions: [
        wholeSelectionInput,
        document.of(formattedDocument.of({ tabId: 'physical', revision: 1 })),
        formattedPrefix.of(() => prefix.length),
        extensions,
      ],
    }),
    dispatch(spec) {
      this.state = this.state.update(spec).state
      this.commits++
    },
  }
  const event = {
    target: view.contentDOM,
    charCode: 90,
    key: 'Z',
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
  return { view, event }
}

test('physical whole-note replacement commits once and retains source outside the body', () => {
  for (const prefix of ['', 'metadata\n\n']) {
    const { view, event } = fixture([], prefix)
    assert.equal(keypress(event, view), true)
    assert.equal(view.state.doc.toString(), `${prefix}Z`)
    assert.equal(view.state.selection.main.head, prefix.length + 1)
    assert.equal(view.commits, 1)
    assert.equal(event.defaultPrevented, true)
  }
})

test('physical whole-note handling respects input ownership and key guards', () => {
  for (const change of [
    ({ view }) => {
      view.hasFocus = false
    },
    ({ view }) => {
      view.composing = true
    },
    ({ view }) => {
      view.compositionStarted = true
    },
    ({ event }) => {
      event.target = {}
    },
    ({ event }) => {
      event.defaultPrevented = true
    },
    ({ event }) => {
      event.isComposing = true
    },
    ({ event }) => {
      event.key = 'Dead'
    },
    ({ event }) => {
      event.key = 'Process'
    },
    ({ event }) => {
      event.ctrlKey = true
    },
    ({ event }) => {
      event.metaKey = true
    },
    ({ event }) => {
      event.charCode = 0
    },
    ({ event }) => {
      event.charCode = 9
    },
    ({ event }) => {
      event.charCode = 10
    },
    ({ event }) => {
      event.charCode = 13
    },
  ]) {
    const f = fixture()
    change(f)
    assert.equal(keypress(f.event, f.view), false)
    assert.equal(f.view.state.doc.toString(), source)
    assert.equal(f.view.commits, 0)
  }
  for (const extension of [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ]) {
    const { event, view } = fixture(extension)
    assert.equal(keypress(event, view), false)
    assert.equal(view.commits, 0)
  }
})

test('new selections and external document identities clear whole-note intent', () => {
  for (const revision of [false, true]) {
    const { event, view } = fixture()
    if (revision)
      view.dispatch({
        effects: document.reconfigure(
          formattedDocument.of({ tabId: 'physical', revision: 2 }),
        ),
      })
    else view.dispatch({ selection: { anchor: 5 } })
    assert.equal(keypress(event, view), false)
    assert.equal(view.state.doc.toString(), source)
    assert.equal(view.commits, 1)
  }
})
