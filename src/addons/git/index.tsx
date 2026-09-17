import { GitBranch } from 'lucide-react'
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
    const draft = { message: '' }
    const view = context.sidebar.register({
      id: 'repository',
      label: 'Git',
      icon: GitBranch,
      Content: () => <GitPanel context={context} draft={draft} />,
    })
    const open = () => view.open()
    context.commands.register({
      id: 'status',
      label: 'Git: status, diffs, and commits',
      keywords: 'repository stage unstage',
      run: open,
    })
    context.commands.register({
      id: 'branches',
      label: 'Git: switch branch',
      run: open,
    })
    for (const action of ['pull', 'push'] as const)
      context.commands.register({
        id: action,
        label: `Git: ${action}`,
        async run() {
          await context.native.invoke(action)
          context.notify(
            action === 'pull' ? 'repository updated.' : 'commits pushed.',
          )
        },
      })
  },
})
