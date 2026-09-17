import { defineAddon } from '../api'
import manifest from './manifest'
import { addFrontmatter, parseFrontmatter } from './markdown'
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
      label: 'Add frontmatter',
      slash: {
        label: 'Frontmatter',
        description: 'Add page properties',
        keywords: 'properties metadata yaml',
        when: (source) => !parseFrontmatter(source),
        transform: addFrontmatter,
      },
      run: () => context.editor.updateMarkdown(addFrontmatter),
    })
  },
})
