import { Extension } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { marked } from 'marked'
import { search } from 'prosemirror-search'

export const extensions = [
  Extension.create({
    name: 'findInNote',
    addProseMirrorPlugins: () => [search()],
  }),
  StarterKit.configure({ underline: false, link: { openOnClick: false } }),
  Markdown,
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image,
  Placeholder.configure({ placeholder: 'start typing' }),
]

// Preserve source constructs the rich editor cannot round-trip without loss.
export function needsSourceEditing(source: string): boolean {
  if (
    /^(?:\uFEFF)?---\r?\n/.test(source) ||
    /^\s{0,3}\[[^\]]+\]:/m.test(source)
  )
    return true
  let unsupported = false
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === 'html' || token.type === 'def') unsupported = true
  })
  return unsupported
}
