import { Extension } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { marked } from 'marked'
import { search } from 'prosemirror-search'
import type { MarkdownExtension, MarkdownProjection } from '../../addons/api'
import { readFrontmatter } from '../../shared/frontmatter'

export function projectMarkdown(
  source: string,
  adapters: readonly MarkdownExtension[],
): MarkdownProjection {
  let result: MarkdownProjection = {
    content: source,
    serialize: (content) => content,
  }
  for (const adapter of adapters) {
    const next = adapter.parse(result.content)
    if (!next) continue
    const previous = result
    result = {
      content: next.content,
      serialize: (content) => previous.serialize(next.serialize(content)),
      readOnly: Boolean(previous.readOnly || next.readOnly),
    }
  }
  return result
}

export const extensions = [
  Extension.create({
    name: 'findInNote',
    addProseMirrorPlugins: () => [search()],
  }),
  StarterKit.configure({
    underline: false,
    trailingNode: false,
    link: { openOnClick: false },
  }),
  Markdown,
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'start typing' }),
]

// Preserve source constructs the rich editor cannot round-trip without loss.
export function needsSourceEditing(source: string): boolean {
  if (readFrontmatter(source) || /^\s{0,3}\[[^\]]+\]:/m.test(source))
    return true
  let unsupported = false
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === 'html' || token.type === 'def') unsupported = true
  })
  return unsupported
}
