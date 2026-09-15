import { defineAddon } from '../api'
import manifest from './manifest'
import { parseFrontmatter } from './markdown'

export default defineAddon({
  manifest,
  start(context) {
    context.editor.registerMarkdown({ id: 'metadata', parse: parseFrontmatter })
  },
})
