import { defineAddon } from '../api'
import manifest from './manifest'
import { parseFrontmatter } from './markdown'
import { Properties } from './Properties'
import { Settings } from './Settings'

export default defineAddon({
  manifest,
  Settings,
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
          const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
          const eol = source.includes('\r\n') ? '\r\n' : '\n'
          return `${bom}---${eol}{}${eol}---${eol}${eol}${source.slice(bom.length)}`
        }),
    })
  },
})
