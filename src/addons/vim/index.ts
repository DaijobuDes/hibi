import { defineAddon } from '../api'
import manifest from './manifest'
import { Settings } from './Settings'
import css from './vim.css?inline'

export default defineAddon({
  manifest,
  Settings,
  start(context) {
    context.styles.register('editor', css)
    context.editor.registerSource({
      id: 'keymap',
      create: async () => (await import('./engine')).createVim(context),
    })
  },
})
