import { Strike } from '@tiptap/extension-strike'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Marked } from 'marked'
import { defineAddon, type MarkdownFlavor } from '../api'
import manifest from './manifest'

const parser = new Marked({ gfm: true })
const flavor: MarkdownFlavor = {
  id: 'github',
  name: 'github markdown',
  kind: 'dialect',
  description: 'tables, task lists, strikethrough, and automatic links.',
  detect(source) {
    let found = false
    parser.walkTokens(parser.lexer(source), (token) => {
      if (
        token.type === 'table' ||
        token.type === 'del' ||
        (token.type === 'list_item' && token.task) ||
        (token.type === 'link' && !token.raw.startsWith('['))
      )
        found = true
    })
    return found
  },
  markedOptions: { gfm: true },
  richExtensions: [
    Strike,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
}
export default defineAddon({
  manifest,
  flavors: [flavor],
  start(context) {
    context.editor.registerFlavor(flavor)
  },
})
