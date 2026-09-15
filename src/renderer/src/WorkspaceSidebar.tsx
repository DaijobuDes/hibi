import { FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { WorkspaceEntry, WorkspaceState } from '../../shared/workspace'
import { IconButton } from '../../ui/Controls'
import { Sidebar, type SidebarItem, type SidebarProps } from '../../ui/Sidebar'
import type { RegisteredCommand } from './addons'

export function WorkspaceSidebar({
  workspace,
  onOpen,
  onFile,
  onRefresh,
  commands,
  open,
  resize,
}: {
  workspace: WorkspaceState | null
  onOpen: () => void
  onFile: (path: string) => void
  onRefresh: () => void
  commands: RegisteredCommand[]
  open: boolean
  resize: NonNullable<SidebarProps['resize']>
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
      resize={resize}
      open={open}
      className={`workspace-sidebar ${workspace ? '' : 'workspace-empty'}`}
      items={items}
      selected={workspace?.activePath ?? null}
      onSelect={onFile}
      label="workspace files"
      header={
        workspace && (
          <>
            <span>{workspace?.name ?? 'workspace'}</span>
            <IconButton
              type="button"
              aria-label="open workspace"
              title="open folder"
              onClick={onOpen}
            >
              <FolderOpen size={15} />
            </IconButton>
            {workspace && (
              <IconButton
                type="button"
                aria-label="refresh workspace"
                title="refresh files"
                onClick={onRefresh}
              >
                <RefreshCw size={14} />
              </IconButton>
            )}
          </>
        )
      }
      empty={
        workspace ? (
          'no markdown files in this folder.'
        ) : (
          <button
            className="open-workspace"
            type="button"
            aria-label="open workspace"
            onClick={onOpen}
          >
            <FolderOpen size={28} strokeWidth={1.25} aria-hidden="true" />
            <span>open a folder</span>
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
