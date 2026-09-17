import { Strike } from '@tiptap/extension-strike'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { defineAddon, type MarkdownFlavor } from '../api'
import { GithubAlert } from './Alert'
import { alertMarkdown, alertMarker } from './alerts'
import css from './alerts.css?inline'
import { flavorInfo } from './flavor-info'
import manifest from './manifest'

const flavor: MarkdownFlavor = {
  ...flavorInfo,
  markedOptions: { gfm: true },
  richExtensions: [
    GithubAlert,
    Strike,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
  export: { extensions: [alertMarkdown], css },
}
export default defineAddon({
  manifest,
  flavors: [flavor],
  start(context) {
    context.editor.registerSyntax({
      id: 'tables',
      label: 'Tables',
      group: 'github markdown',
      level: 'block',
      extensions: ['tableKit'],
      matches: (token) => token.type === 'table',
    })
    context.editor.registerSyntax({
      id: 'tasks',
      label: 'Task lists',
      group: 'github markdown',
      description: '- [ ] task',
      level: 'block',
      extensions: ['taskList', 'taskItem'],
      matches: (token) =>
        token.type === 'list' &&
        token.items.some((item: { task?: boolean }) => item.task),
    })
    context.editor.registerSyntax({
      id: 'strike',
      label: 'Strikethrough',
      group: 'github markdown',
      description: '~~text~~',
      level: 'inline',
      extensions: ['strike'],
      matches: (token) => token.type === 'del',
    })
    context.editor.registerSyntax({
      id: 'alerts',
      label: 'Alerts',
      group: 'github markdown',
      description: 'Note, tip, important, warning, and caution.',
      level: 'block',
      extensions: ['githubAlert'],
      matches: (token) =>
        token.type === 'githubAlert' ||
        (token.type === 'blockquote' && !!alertMarker(token.text)),
    })
    context.styles.register('alerts', css)
    context.editor.registerFlavor(flavor)
  },
})
