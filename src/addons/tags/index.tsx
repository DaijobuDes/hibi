import { Tags } from 'lucide-react'
import { isMarkdownDocument } from '../../shared/document-types'
import { defineAddon } from '../api'
import { richTags, sourceTags } from './decorations'
import manifest from './manifest'
import { TagsPanel } from './Panel'
import css from './style.css?inline'
import { noteTags } from './syntax'

export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('tags', css)
    const browse = (tag?: string) => {
      context.dialogs.open({
        title: 'tags',
        size: 'wide',
        content: ({ close }) => (
          <TagsPanel
            context={context}
            initialTag={tag}
            close={() => close(null)}
          />
        ),
      })
    }
    context.commands.register({
      id: 'browse',
      label: 'browse tags',
      keywords: 'hashtags notes',
      run: () => browse(),
    })
    context.toolbar.register({
      id: 'browse',
      label: 'browse tags',
      icon: Tags,
      onClick: () => browse(),
    })
    const status = context.statusBar.register({
      id: 'tags',
      label: 'tags',
      tooltip: 'browse workspace tags',
      onClick: () => browse(),
    })
    context.editor.onDocumentChange((document) => {
      const tags = isMarkdownDocument(document.name)
        ? noteTags(document.markdown)
        : []
      status.update({
        label: tags.length ? `tags · ${tags.length}` : 'tags',
        tooltip: tags.length
          ? tags.map((tag) => `#${tag}`).join(' · ')
          : 'browse workspace tags',
      })
    })
    context.editor.registerRich(richTags(browse))
    context.editor.registerSource(
      sourceTags(browse, () =>
        isMarkdownDocument(context.editor.getDocument()?.name ?? ''),
      ),
    )
  },
})
