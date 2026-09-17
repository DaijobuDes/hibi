import { FolderOpen, ListTree, PanelLeft } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import type { SidebarView } from '../../addons/api'
import { Button } from '../../ui/Controls'
import { Sidebar, type SidebarProps } from '../../ui/Sidebar'

export const builtInViews = [
  { id: 'workspace', label: 'Workspace', icon: FolderOpen },
  { id: 'outline', label: 'In this page', icon: ListTree },
]

export function viewShortcut(view: SidebarView) {
  return { id: view.id, label: view.label, icon: view.icon ?? PanelLeft }
}

class ViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="sidebar-empty" role="alert">
        <p>This view could not load.</p>
        <Button onClick={() => this.setState({ failed: false })}>Retry</Button>
      </div>
    ) : (
      this.props.children
    )
  }
}

export function AddonSidebar({
  view,
  input,
  open,
  resize,
}: {
  view: SidebarView | undefined
  input: unknown
  open: boolean
  resize: NonNullable<SidebarProps['resize']>
}) {
  return (
    <Sidebar
      className="document-sidebar addon-sidebar"
      label={view?.label ?? 'Addon view'}
      header={<span>{view?.label}</span>}
      items={[]}
      selected={null}
      onSelect={() => {}}
      open={open && !!view}
      resize={resize}
      content={
        open && view ? (
          <ViewBoundary key={view.id}>
            <view.Content input={input} />
          </ViewBoundary>
        ) : null
      }
    />
  )
}
