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
        title: 'Workspace graph',
        size: 'wide',
        content: ({ close }) => (
          <GraphPanel context={context} close={() => close(null)} />
        ),
      })
    }
    context.commands.register({
      id: 'open',
      label: 'Open workspace graph',
      keywords: 'notes links connections backlinks',
      run: open,
    })
    context.toolbar.register({
      id: 'open',
      label: 'Workspace graph',
      icon: Network,
      onClick: open,
    })
    context.statusBar.register({
      id: 'open',
      label: 'Graph',
      tooltip: 'Explore workspace connections',
      onClick: open,
    })
  },
})
