import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  search,
  setSearchQuery,
} from '@codemirror/search'
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { FindMove, FindStatus } from './FindBar'

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
  externalRevision,
  findActive,
  findQuery,
  findMove,
  onFindStatus,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  externalRevision: number
  findActive: boolean
  findQuery: string
  findMove: FindMove
  onFindStatus: (status: FindStatus) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  const initialValue = useRef(value)
  const appliedRevision = useRef(externalRevision)
  const editable = useRef(new Compartment())
  const find = useRef({ active: findActive, report: onFindStatus })
  const handledFindMove = useRef(findMove.id)
  find.current = { active: findActive, report: onFindStatus }
  change.current = onChange

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          search({
            createPanel: () => {
              const dom = window.document.createElement('div')
              dom.hidden = true
              return { dom }
            },
          }),
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
            if (find.current.active) {
              const query = getSearchQuery(update.state)
              let total = 0
              let current = 0
              if (query.valid) {
                const cursor = query.getCursor(update.state)
                for (
                  let match = cursor.next();
                  !match.done;
                  match = cursor.next()
                ) {
                  total += 1
                  if (
                    match.value.from === update.state.selection.main.from &&
                    match.value.to === update.state.selection.main.to
                  )
                    current = total
                }
              }
              find.current.report({ current, total })
            }
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
    // Only reconcile edits from the other pane; never replay our own stale props.
    if (appliedRevision.current === externalRevision) return
    appliedRevision.current = externalRevision
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
  }, [value, externalRevision])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorView.editable.of(!disabled)),
    })
  }, [disabled])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (!findActive) {
      closeSearchPanel(editor)
      return
    }
    openSearchPanel(editor)
    const query = new SearchQuery({ search: findQuery, literal: true })
    editor.dispatch({ effects: setSearchQuery.of(query) })
    const first = query.valid ? query.getCursor(editor.state).next() : null
    if (first && !first.done)
      editor.dispatch({
        selection: { anchor: first.value.from, head: first.value.to },
        scrollIntoView: true,
      })
  }, [findActive, findQuery])

  useEffect(() => {
    if (handledFindMove.current === findMove.id) return
    handledFindMove.current = findMove.id
    if (findActive && view.current && findMove.id)
      (findMove.direction === 'next' ? findNext : findPrevious)(view.current)
  }, [findActive, findMove])

  return <div className="source-editor" ref={host} />
}
