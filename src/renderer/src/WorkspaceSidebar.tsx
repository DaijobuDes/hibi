import { FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { WorkspaceEntry, WorkspaceState } from '../../shared/workspace'
import { Sidebar, type SidebarItem } from '../../ui/Sidebar'
import type { RegisteredCommand } from './addons'

export function WorkspaceSidebar({
  workspace,
  onOpen,
  onFile,
  onRefresh,
  commands,
}: {
  workspace: WorkspaceState | null
  onOpen: () => void
  onFile: (path: string) => void
  onRefresh: () => void
  commands: RegisteredCommand[]
}) {
  const items = useMemo(() => {
    const convert = (entries: WorkspaceEntry[]): SidebarItem[] =>
      entries.map((entry) => ({
        id: entry.path,
        label: entry.name,
        icon: entry.kind === 'folder' ? Folder : FileText,
        ...(entry.children ? { children: convert(entry.children) } : {}),
      }))
    return convert(workspace?.entries ?? [])
  }, [workspace?.entries])
  return (
    <Sidebar
      className="workspace-sidebar"
      items={items}
      selected={workspace?.activePath ?? null}
      onSelect={onFile}
      label="workspace files"
      header={
        <>
          <span>{workspace?.name ?? 'workspace'}</span>
          <button
            type="button"
            aria-label="open workspace"
            title="open folder"
            onClick={onOpen}
          >
            <FolderOpen size={15} />
          </button>
          {workspace && (
            <button
              type="button"
              aria-label="refresh workspace"
              title="refresh files"
              onClick={onRefresh}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </>
      }
      empty={
        workspace ? (
          'no markdown files in this folder.'
        ) : (
          <button type="button" onClick={onOpen}>
            open a folder…
          </button>
        )
      }
      footer={
        workspace &&
        commands
          .filter((command) => command.workspace)
          .map((command) => (
            <button
              key={command.id}
              type="button"
              onClick={() => void command.run()}
            >
              {command.label}
            </button>
          ))
      }
    />
  )
}
