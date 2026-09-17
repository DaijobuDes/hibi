import { lazy } from 'react'
import { defineAddon } from '../api'
import manifest from './manifest'
import { vimPreferences } from './preferences'
import css from './vim.css?inline'

let stop: (() => void) | undefined
export default defineAddon({
  manifest,
  Settings: lazy(() =>
    import('./Settings').then(({ Settings }) => ({ default: Settings })),
  ),
  start(context) {
    context.styles.register('editor', css)
    context.editor.registerSource({
      id: 'keymap',
      create: async () => (await import('./engine')).createVim(context),
    })
    const status = context.statusBar.register({
      id: 'unavailable',
      label: '',
      tooltip:
        'Vim mode is disabled in the Normal view mode. Switch to the side-by-side or Markdown-only view to use Vim mode.',
      when: 'normal',
    })
    const applyPreferences = () => {
      status.update({ label: vimPreferences().status ? 'Vim · off' : '' })
    }
    applyPreferences()
    window.addEventListener('hibi:vim-settings', applyPreferences)
    stop = () =>
      window.removeEventListener('hibi:vim-settings', applyPreferences)
  },
  stop() {
    stop?.()
    stop = undefined
  },
})
