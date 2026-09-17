import { defineAddon, type ExportResult } from '../api'
import manifest from './manifest'

export default defineAddon({
  manifest,
  start(context) {
    context.commands.register({
      id: 'export',
      label: 'export documentation',
      async run() {
        const workspace =
          (await context.workspace.get()) ?? (await context.workspace.open())
        if (!workspace) return
        const snapshot = await context.workspace.snapshot()
        const styles = new Set<string>()
        const pages = []
        for (const page of snapshot.pages) {
          const rendered = await context.editor.renderDocument(
            page.markdown,
            page.path,
            page.id,
          )
          if (rendered.css) styles.add(rendered.css)
          pages.push({
            path: page.path,
            markdown: page.markdown,
            html: rendered.html,
          })
        }
        const result = await context.native.invoke<ExportResult | null>(
          'export',
          { pages, css: [...styles].join('\n') },
        )
        if (result)
          context.notify(`exported ${result.pages} pages to ${result.path}`)
      },
    })
  },
})
