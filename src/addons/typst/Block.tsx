import { mergeAttributes, Node } from '@tiptap/core'
import {
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import { FileDown, Pencil } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconButton } from '../../ui/Controls'
import type { AddonContext } from '../api'
import { TypstPreview } from './Preview'
import { typstBlock } from './syntax'

function TypstForm({
  source,
  close,
}: {
  source: string
  close: (source: string | null) => void
}) {
  const [value, setValue] = useState(source)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  return (
    <form
      className="dialog-form"
      onSubmit={(event) => {
        event.preventDefault()
        close(value)
      }}
    >
      <label htmlFor="typst-source">typst source</label>
      <textarea
        id="typst-source"
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={12}
        spellCheck={false}
      />
      <div className="dialog-actions">
        <Button onClick={() => close(null)}>cancel</Button>
        <Button type="submit">apply</Button>
      </div>
    </form>
  )
}

export function typstNode(context: AddonContext) {
  function View({ node, editor, getPos, updateAttributes }: NodeViewProps) {
    const source = String(node.attrs.source ?? '')
    const documentId = useSyncExternalStore(
      context.editor.onDocumentChange,
      context.editor.getDocument,
    )?.id
    async function edit() {
      const value = await context.dialogs.open<string>({
        title: 'edit typst block',
        size: 'wide',
        content: ({ close }) => <TypstForm source={source} close={close} />,
      }).result
      if (value === null || editor.isDestroyed) return
      const position = getPos()
      if (
        position !== undefined &&
        editor.state.doc.nodeAt(position)?.attrs.source === source
      )
        updateAttributes({ source: value })
    }
    async function pdf() {
      try {
        const path = await context.native.invoke<string | null>('pdf', {
          source,
          documentId,
          block: true,
        })
        if (path) context.notify(`exported pdf to ${path}`)
      } catch (error) {
        context.toasts.show({
          message:
            error instanceof Error ? error.message : 'could not export typst.',
          variant: 'error',
        })
      }
    }
    return (
      <NodeViewWrapper className="typst-block" contentEditable={false}>
        <div className="typst-block-heading">
          <span>typst</span>
          <div>
            <IconButton
              aria-label="edit typst block"
              onClick={() => void edit()}
            >
              <Pencil size={16} />
            </IconButton>
            <IconButton
              aria-label="export typst block pdf"
              onClick={() => void pdf()}
            >
              <FileDown size={16} />
            </IconButton>
          </div>
        </div>
        <TypstPreview
          value={source}
          documentId={documentId}
          context={context}
          block
        />
      </NodeViewWrapper>
    )
  }
  return Node.create({
    name: 'typstBlock',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes: () => ({ source: { default: '' }, raw: { default: '' } }),
    parseHTML: () => [
      {
        tag: 'pre[data-type="typst-block"]',
        getAttrs: (element) => ({ source: element.textContent ?? '' }),
      },
    ],
    renderHTML: ({ node, HTMLAttributes }) => [
      'pre',
      mergeAttributes(HTMLAttributes, { 'data-type': 'typst-block' }),
      ['code', { class: 'language-typst' }, node.attrs.source],
    ],
    markdownTokenName: 'typstBlock',
    markdownTokenizer: {
      name: 'typstBlock',
      level: 'block',
      tokenize: typstBlock,
    },
    parseMarkdown: (token, helpers) =>
      helpers.createNode('typstBlock', {
        source: token.source,
        raw: token.raw,
      }),
    renderMarkdown: (node) => {
      const source = String(node.attrs?.source ?? '')
      const raw = String(node.attrs?.raw ?? '')
      if (raw && typstBlock(raw)?.source === source)
        return raw.replace(/\r?\n$/, '')
      const length = Math.max(
        3,
        ...Array.from(source.matchAll(/`+/g), (match) => match[0].length + 1),
      )
      const fence = '`'.repeat(length)
      return `${fence}typst\n${source}\n${fence}`
    },
    addNodeView: () => ReactNodeViewRenderer(View),
  })
}
