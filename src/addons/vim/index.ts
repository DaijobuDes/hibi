import { defineAddon } from '../api'
import manifest from './manifest'
import { Settings } from './Settings'

export default defineAddon({
  manifest,
  Settings,
  start(context) {
    context.editor.registerSource({
      id: 'keymap',
      create: async () => (await import('./engine')).createVim(context),
    })
  },
})
