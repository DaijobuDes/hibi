import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import {
  findNext,
  findPrev,
  getMatchHighlights,
  SearchQuery,
  setSearchState,
} from 'prosemirror-search'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FindBar, type FindMove, type FindStatus } from './FindBar'
import { LoadingScreen } from './LoadingScreen'
import { extensions, needsSourceEditing } from './markdown'

const SourceEditor = lazy(() =>
  import('./SourceEditor').then((module) => ({ default: module.SourceEditor })),
)

export type ViewMode = 'normal' | 'side-by-side' | 'markdown'

export function MarkdownEditor({
  value,
  onChange,
  mode,
  disabled,
  findOpen,
  onCloseFind,
}: {
  value: string
  onChange: (value: string) => void
  mode: ViewMode
  disabled: boolean
  findOpen: boolean
  onCloseFind: () => void
}) {
  const sourceOnly = needsSourceEditing(value)
  const [richRevision, setRichRevision] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [findStatus, setFindStatus] = useState<FindStatus>({
    current: 0,
    total: 0,
  })
  const [findMove, setFindMove] = useState<FindMove>({
    id: 0,
    direction: 'next',
  })
  const handledFindMove = useRef(0)
  const [focusedPane, setFocusedPane] = useState<'rich' | 'source'>('rich')
  const findTarget =
    mode === 'normal' ? 'rich' : mode === 'markdown' ? 'source' : focusedPane
  const [sourceMounted, setSourceMounted] = useState(mode !== 'normal')
  useEffect(() => {
    if (mode !== 'normal') setSourceMounted(true)
  }, [mode])
  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    autofocus: 'end',
    injectCSS: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'aria-label': 'document editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown())
      setRichRevision((revision) => revision + 1)
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!sourceOnly && !disabled, false)
  }, [editor, sourceOnly, disabled])

  useEffect(() => {
    if (!editor || !findOpen || findTarget !== 'rich') return
    const report = () => {
      const matches = getMatchHighlights(editor.state).find()
      const selection = editor.state.selection
      setFindStatus({
        total: matches.length,
        current:
          matches.findIndex(
            (match) =>
              match.from === selection.from && match.to === selection.to,
          ) + 1,
      })
    }
    editor.on('transaction', report)
    report()
    return () => {
      editor.off('transaction', report)
    }
  }, [editor, findOpen, findTarget])

  useEffect(() => {
    if (!editor) return
    const query = new SearchQuery({
      search: findOpen && findTarget === 'rich' ? findQuery : '',
      literal: true,
    })
    editor.view.dispatch(setSearchState(editor.state.tr, query))
    const first = query.valid ? query.findNext(editor.state, 0) : null
    if (first)
      editor.view.dispatch(
        editor.state.tr
          .setSelection(
            TextSelection.create(editor.state.doc, first.from, first.to),
          )
          .scrollIntoView(),
      )
  }, [editor, findQuery, findOpen, findTarget])

  useEffect(() => {
    if (handledFindMove.current === findMove.id) return
    handledFindMove.current = findMove.id
    if (editor && findOpen && findTarget === 'rich' && findMove.id) {
      const command = findMove.direction === 'next' ? findNext : findPrev
      command(editor.state, (transaction) => editor.view.dispatch(transaction))
    }
  }, [editor, findMove, findOpen, findTarget])

  function updateFromSource(markdown: string) {
    editor
      ?.chain()
      .setContent(markdown, { contentType: 'markdown', emitUpdate: false })
      .setMeta('addToHistory', false)
      .run()
    onChange(markdown)
  }

  return (
    <>
      <FindBar
        open={findOpen}
        query={findQuery}
        onQuery={setFindQuery}
        status={findStatus}
        onMove={(direction) =>
          setFindMove((move) => ({ id: move.id + 1, direction }))
        }
        onClose={() => {
          onCloseFind()
          if (findTarget === 'rich') editor?.commands.focus()
          else
            window.document
              .querySelector<HTMLElement>('.source-pane .cm-content')
              ?.focus()
        }}
      />
      {sourceOnly && mode !== 'markdown' && (
        <div className="source-notice" role="status">
          edit this document’s html, references, or frontmatter in markdown
          view.
        </div>
      )}
      <main className={`editor-panes mode-${mode}`}>
        <section
          className="rich-pane"
          onFocusCapture={() => setFocusedPane('rich')}
          aria-label="formatted document"
          hidden={mode === 'markdown'}
        >
          <EditorContent editor={editor} />
        </section>
        <section
          className="source-pane"
          onFocusCapture={() => setFocusedPane('source')}
          aria-label="markdown source"
          hidden={mode === 'normal'}
        >
          {sourceMounted && (
            <Suspense
              fallback={<LoadingScreen label="loading markdown editor" />}
            >
              <SourceEditor
                value={value}
                externalRevision={richRevision}
                onChange={updateFromSource}
                disabled={disabled}
                findActive={findOpen && findTarget === 'source'}
                findQuery={findQuery}
                findMove={findMove}
                onFindStatus={setFindStatus}
              />
            </Suspense>
          )}
        </section>
      </main>
    </>
  )
}
