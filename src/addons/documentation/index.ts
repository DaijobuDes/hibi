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
        const pages = snapshot.pages.map((page) => {
          const rendered = context.editor.renderMarkdown(page.markdown, page.id)
          if (rendered.css) styles.add(rendered.css)
          return {
            path: page.path,
            markdown: page.markdown,
            html: rendered.html,
          }
        })
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
