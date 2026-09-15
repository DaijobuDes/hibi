import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const externalChange = Annotation.define<boolean>()
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ink)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url, tags.monospace], color: 'var(--accent)' },
  {
    tag: [tags.meta, tags.quote, tags.processingInstruction],
    color: 'var(--muted)',
  },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
])

export function SourceEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  const initialValue = useRef(value)
  const editable = useRef(new Compartment())
  change.current = onChange

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          editable.current.of(EditorView.editable.of(true)),
          markdownLanguage(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(highlighting),
          EditorView.lineWrapping,
          placeholder('start typing'),
          EditorView.contentAttributes.of({
            'aria-label': 'markdown editor',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalChange),
              )
            ) {
              change.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: [
          externalChange.of(true),
          Transaction.addToHistory.of(false),
        ],
      })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorView.editable.of(!disabled)),
    })
  }, [disabled])

  return <div className="source-editor" ref={host} />
}
