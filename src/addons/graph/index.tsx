import { Network } from 'lucide-react'
import { defineAddon } from '../api'
import manifest from './manifest'
import { GraphPanel } from './Panel'
import css from './style.css?inline'
export default defineAddon({
  manifest,
  start(context) {
    context.styles.register('graph', css)
    const view = context.sidebar.register({
      id: 'workspace',
      label: 'Workspace graph',
      icon: Network,
      Content: () => <GraphPanel context={context} />,
    })
    const open = () => view.open()
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
  },
})
