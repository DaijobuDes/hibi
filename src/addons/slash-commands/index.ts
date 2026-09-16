import { defineAddon } from '../api'
import manifest from './manifest'
import { attachRich } from './rich'
import css from './slash.css?inline'

export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('menu', css)
    context.editor.registerRich({ id: 'menu', attach: attachRich })
    context.editor.registerSource({
      id: 'menu',
      create: async () => (await import('./source')).sourceSlashCommands(),
    })
  },
})
