import { defineAddon } from '../api'
import manifest from './manifest'
import { parseFrontmatter } from './markdown'
import { Properties } from './Properties'

export default defineAddon({
  manifest,
  start(context) {
    context.editor.registerMarkdown({
      id: 'metadata',
      parse: parseFrontmatter,
      Editor: Properties,
    })
    context.commands.register({
      id: 'add',
      label: 'add frontmatter',
      run: () =>
        context.editor.updateMarkdown((source) => {
          if (parseFrontmatter(source)) return source
          if (/^(?:\uFEFF)?---[ \t]*\r?\n/.test(source))
            throw new Error(
              'close the existing frontmatter block in markdown view first.',
            )
          return `---\n---\n\n${source}`
        }),
    })
  },
})
