import { EditorContent, useEditor } from '@tiptap/react'
import { lazy, Suspense, useEffect, useState } from 'react'
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
}: {
  value: string
  onChange: (value: string) => void
  mode: ViewMode
  disabled: boolean
}) {
  const sourceOnly = needsSourceEditing(value)
  const [richRevision, setRichRevision] = useState(0)
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
      <div id="format-menu" popover="auto">
        {editor && !sourceOnly && (
          <fieldset
            className="formats"
            aria-label="formatting"
            disabled={disabled}
          >
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <strong>bold</strong>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <em>italic</em>
            </button>
            <button
              type="button"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              heading
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              list
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              quote
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              code
            </button>
          </fieldset>
        )}
      </div>
      {sourceOnly && mode !== 'markdown' && (
        <div className="source-notice" role="status">
          edit this document’s html, references, or frontmatter in markdown
          view.
        </div>
      )}
      <main className={`editor-panes mode-${mode}`}>
        <section
          className="rich-pane"
          aria-label="formatted document"
          hidden={mode === 'markdown'}
        >
          <EditorContent editor={editor} />
        </section>
        <section
          className="source-pane"
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
              />
            </Suspense>
          )}
        </section>
      </main>
    </>
  )
}
