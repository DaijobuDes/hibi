import { Network } from 'lucide-react'
import { defineAddon } from '../api'
import manifest from './manifest'
import { GraphPanel } from './Panel'
import css from './style.css?inline'
export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('graph', css)
    const open = () => {
      context.dialogs.open({
        title: 'workspace graph',
        size: 'wide',
        content: ({ close }) => (
          <GraphPanel context={context} close={() => close(null)} />
        ),
      })
    }
    context.commands.register({
      id: 'open',
      label: 'open workspace graph',
      keywords: 'notes links connections backlinks',
      run: open,
    })
    context.toolbar.register({
      id: 'open',
      label: 'workspace graph',
      icon: Network,
      onClick: open,
    })
    context.statusBar.register({
      id: 'open',
      label: 'graph',
      tooltip: 'explore workspace connections',
      onClick: open,
    })
  },
})
