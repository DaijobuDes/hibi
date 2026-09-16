import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import {
  findNext,
  findPrev,
  getMatchHighlights,
  SearchQuery,
  setSearchState,
} from 'prosemirror-search'
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  MarkdownExtension,
  RichExtension,
  SourceExtension,
} from '../../addons/api'
import { documentImage } from './DocumentImage'
import { type CursorSettings, EditorCursor } from './EditorCursor'
import { emitEditorKeyEvent } from './editor-events'
import { FindBar, type FindMove, type FindStatus } from './FindBar'
import { LoadingScreen } from './LoadingScreen'
import { extensions, needsSourceEditing, projectMarkdown } from './markdown'

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
  markdownExtensions,
  sourceExtensions,
  richExtensions,
  cursorSettings,
  showLineNumbers,
  documentRevision,
}: {
  value: string
  onChange: (value: string) => void
  mode: ViewMode
  disabled: boolean
  findOpen: boolean
  onCloseFind: () => void
  markdownExtensions: readonly MarkdownExtension[]
  sourceExtensions: readonly SourceExtension[]
  richExtensions: readonly RichExtension[]
  cursorSettings: CursorSettings
  showLineNumbers: boolean
  documentRevision: number
}) {
  const projection = useMemo(
    () => projectMarkdown(value, markdownExtensions),
    [value, markdownExtensions],
  )
  const sourceOnly = useMemo(
    () =>
      Boolean(projection.readOnly) || needsSourceEditing(projection.content),
    [projection],
  )
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
  const [sourceReady, setSourceReady] = useState(false)
  const paneMode = sourceReady || mode === 'normal' ? mode : 'normal'
  const content = useRef<HTMLDivElement>(null)
  const previousMode = useRef(paneMode)
  useLayoutEffect(() => {
    if (previousMode.current === paneMode) return
    previousMode.current = paneMode
    const element = content.current
    if (!element) return
    const opacity = Number(getComputedStyle(element).opacity)
    for (const animation of element.getAnimations()) animation.cancel()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const duration = getComputedStyle(element)
      .getPropertyValue('--motion-feedback')
      .trim()
    element.animate(
      [
        { opacity, offset: 0 },
        { opacity: 0, offset: 0.25 },
        { opacity: 0, offset: 0.625 },
        { opacity: 1, offset: 1 },
      ],
      {
        duration:
          Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) ||
          160,
      },
    )
  }, [paneMode])
  useEffect(() => {
    const idle = requestIdleCallback(() => setSourceMounted(true))
    return () => cancelIdleCallback(idle)
  }, [])
  useEffect(() => {
    if (mode !== 'normal') setSourceMounted(true)
  }, [mode])
  const editor = useEditor(
    {
      extensions: [...extensions, documentImage(documentRevision)],
      content: projection.content,
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
        onChange(projection.serialize(editor.getMarkdown()))
        setRichRevision((revision) => revision + 1)
      },
    },
    [markdownExtensions],
  )

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!sourceOnly && !disabled, false)
  }, [editor, sourceOnly, disabled])

  useEffect(() => {
    if (!editor) return
    let detach: (() => void)[] = []
    const cleanup = () => {
      for (const remove of detach) remove()
      detach = []
    }
    const attach = () => {
      cleanup()
      if (!editor.isDestroyed)
        detach = richExtensions.map((extension) => extension.attach(editor))
    }
    editor.on('mount', attach)
    editor.on('unmount', cleanup)
    attach()
    return () => {
      editor.off('mount', attach)
      editor.off('unmount', cleanup)
      cleanup()
    }
  }, [editor, richExtensions])

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
      .setContent(projectMarkdown(markdown, markdownExtensions).content, {
        contentType: 'markdown',
        emitUpdate: false,
      })
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
      <main
        className={`editor-panes mode-${paneMode}`}
        data-source-ready={sourceReady}
        onKeyDownCapture={(event) => emitEditorKeyEvent(event.nativeEvent)}
        onKeyUpCapture={(event) => emitEditorKeyEvent(event.nativeEvent)}
      >
        <div className="editor-content" ref={content}>
          <EditorCursor root={content} settings={cursorSettings} />
          <section
            className="rich-pane"
            onFocusCapture={() => setFocusedPane('rich')}
            aria-label="formatted document"
            aria-hidden={paneMode === 'markdown'}
            inert={paneMode === 'markdown'}
          >
            {markdownExtensions.map(({ id, Editor }) =>
              Editor ? (
                <Editor
                  key={id}
                  value={value}
                  disabled={disabled}
                  onChange={(markdown) => {
                    updateFromSource(markdown)
                    setRichRevision((revision) => revision + 1)
                  }}
                />
              ) : null,
            )}
            <EditorContent editor={editor} />
          </section>
          <section
            className="source-pane"
            onFocusCapture={() => setFocusedPane('source')}
            aria-label="markdown source"
            aria-hidden={paneMode === 'normal'}
            inert={paneMode === 'normal'}
          >
            {sourceMounted && (
              <Suspense
                fallback={<LoadingScreen label="loading markdown editor" />}
              >
                <SourceEditor
                  sourceExtensions={sourceExtensions}
                  showLineNumbers={showLineNumbers}
                  active={mode !== 'normal'}
                  onReady={() => setSourceReady(true)}
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
        </div>
      </main>
    </>
  )
}
