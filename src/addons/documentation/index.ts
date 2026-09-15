import { defineAddon, type ExportResult } from '../api'
import manifest from './manifest'

export default defineAddon({
  manifest,
  start(context) {
    context.commands.register({
      id: 'export',
      label: 'export documentation',
      workspace: true,
      async run() {
        const workspace =
          (await context.workspace.get()) ?? (await context.workspace.open())
        if (!workspace) return
        const result = await context.native.invoke<ExportResult | null>(
          'export',
        )
        if (result)
          context.notify(`exported ${result.pages} pages to ${result.path}`)
      },
    })
  },
})
