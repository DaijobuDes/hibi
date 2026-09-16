import { defineAddon } from '../api'
import { gitDecorations } from './decorations'
import manifest from './manifest'
import { GitPanel } from './Panel'
import type { GitFile } from './types'

export default defineAddon({
  manifest,
  start(context) {
    context.workspace.registerDecorations({
      id: 'status',
      async provide(workspace) {
        const state = await context.native.query<{
          id: string
          files: GitFile[]
        } | null>('decorations')
        return state && state.id === workspace.id
          ? gitDecorations(state.files)
          : []
      },
    })
    const open = () => {
      context.dialogs.open({
        title: 'git',
        size: 'wide',
        content: () => <GitPanel context={context} />,
      })
    }
    context.statusBar.register({
      id: 'repository',
      label: 'git',
      tooltip: 'repository status and branches',
      onClick: open,
    })
    context.commands.register({
      id: 'status',
      label: 'git: status, diffs, and commits',
      keywords: 'repository stage unstage',
      workspace: true,
      run: open,
    })
    context.commands.register({
      id: 'branches',
      label: 'git: switch branch',
      run: open,
    })
    for (const action of ['pull', 'push'] as const)
      context.commands.register({
        id: action,
        label: `git: ${action}`,
        async run() {
          await context.native.invoke(action)
          context.notify(
            action === 'pull' ? 'repository updated.' : 'commits pushed.',
          )
        },
      })
  },
})
