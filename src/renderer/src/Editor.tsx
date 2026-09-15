import { EditorContent, useEditor } from '@tiptap/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { extensions, needsSourceEditing } from './markdown'

const SourceEditor = lazy(() =>
  import('./SourceEditor').then((module) => ({ default: module.SourceEditor })),
)

export type ViewMode = 'normal' | 'side-by-side' | 'markdown'

export function MarkdownEditor({
  value,
  onChange,
  mode,
}: {
  value: string
  onChange: (value: string) => void
  mode: ViewMode
}) {
  const sourceOnly = needsSourceEditing(value)
  const [formatting, setFormatting] = useState(false)
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
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!sourceOnly, false)
    if (editor.getMarkdown() !== value) {
      editor
        .chain()
        .setContent(value, { contentType: 'markdown', emitUpdate: false })
        .setMeta('addToHistory', false)
        .run()
    }
  }, [editor, value, sourceOnly])

  return (
    <>
      <div className="editor-tools">
        {mode !== 'markdown' && (
          <button
            type="button"
            aria-expanded={formatting}
            onClick={() => setFormatting(!formatting)}
          >
            format
          </button>
        )}
        {mode !== 'markdown' && formatting && editor && !sourceOnly && (
          <fieldset className="formats" aria-label="formatting">
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
        {sourceOnly && mode !== 'markdown' && (
          <span role="status">
            edit this document’s html, references, or frontmatter in markdown
            view.
          </span>
        )}
      </div>
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
              fallback={<p className="loading">loading markdown editor…</p>}
            >
              <SourceEditor value={value} onChange={onChange} />
            </Suspense>
          )}
        </section>
      </main>
    </>
  )
}
