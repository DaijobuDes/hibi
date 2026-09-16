import {
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  WorkspaceAction,
  WorkspaceActionResult,
  WorkspaceEntry,
  WorkspaceState,
} from '../../shared/workspace'
import { IconButton } from '../../ui/Controls'
import { useDialogs } from '../../ui/DialogProvider'
import { useMenus } from '../../ui/MenuHost'
import { Sidebar, type SidebarItem, type SidebarProps } from '../../ui/Sidebar'
import type { RegisteredCommand } from './addons'
import { explorerDecorations } from './explorer-decorations'
import { type WorkspaceRename, workspaceMenuItems } from './workspace-menu'

export function WorkspaceSidebar({
  workspace,
  onOpen,
  onFile,
  onRefresh,
  commands,
  open,
  resize,
  dirty,
  onAction,
  onError,
  editing,
  onEditing: setEditing,
}: {
  workspace: WorkspaceState | null
  onOpen: () => void
  onFile: (path: string) => void
  onRefresh: () => void
  commands: RegisteredCommand[]
  open: boolean
  resize: NonNullable<SidebarProps['resize']>
  dirty: boolean
  onAction: (action: WorkspaceAction) => Promise<WorkspaceActionResult | null>
  onError: (error: unknown) => void
  editing: WorkspaceRename
  onEditing: (target: WorkspaceRename) => void
}) {
  const menu = useMenus(onError)
  const dialogs = useDialogs()
  const [renaming, setRenaming] = useState(false)
  const decorations = useSyncExternalStore(
    explorerDecorations.subscribe,
    explorerDecorations.snapshot,
  )
  const rootDecoration = decorations.get('')
  useLayoutEffect(() => {
    explorerDecorations.setWorkspace(workspace)
  }, [workspace])
  useEffect(() => {
    const refresh = () => explorerDecorations.setWorkspace(workspace)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [workspace])
  async function create(kind: 'new-file' | 'new-folder', parent = '') {
    try {
      const result = await onAction({ action: kind, path: parent })
      if (result)
        setEditing({
          id: result.path,
          value: result.path.split('/').at(-1) ?? '',
        })
    } catch (error) {
      onError(error)
    }
  }
  async function commitRename() {
    if (!editing || renaming) return
    setRenaming(true)
    try {
      if (
        await onAction({
          action: 'rename',
          path: editing.id,
          destination: editing.value,
        })
      )
        setEditing(null)
    } catch (error) {
      onError(error)
    } finally {
      setRenaming(false)
    }
  }
  function openMenu(path: string, anchor: HTMLElement) {
    const find = (entries: WorkspaceEntry[]): WorkspaceEntry | undefined => {
      for (const entry of entries) {
        if (entry.path === path) return entry
        const nested = entry.children && find(entry.children)
        if (nested) return nested
      }
    }
    const entry = find(workspace?.entries ?? [])
    if (!entry) return
    menu.open({
      label: `actions for ${entry.name}`,
      anchor,
      items: workspaceMenuItems(entry, {
        dialogs,
        onAction,
        create,
        rename: setEditing,
      }),
    })
  }
  const items = useMemo(() => {
    const convert = (entries: WorkspaceEntry[]): SidebarItem[] =>
      entries.map((entry) => ({
        id: entry.path,
        label: entry.name,
        icon: entry.kind === 'folder' ? Folder : FileText,
        dirty: dirty && workspace?.activePath === entry.path,
        ...(decorations.has(entry.path)
          ? { decoration: decorations.get(entry.path)! }
          : {}),
        ...(entry.children ? { children: convert(entry.children) } : {}),
      }))
    return convert(workspace?.entries ?? [])
  }, [workspace?.entries, workspace?.activePath, dirty, decorations])
  return (
    <Sidebar
      resize={resize}
      open={open}
      className={`workspace-sidebar ${workspace ? '' : 'workspace-empty'}`}
      items={items}
      selected={workspace?.activePath ?? null}
      onSelect={onFile}
      onMenu={openMenu}
      editing={
        editing && {
          ...editing,
          disabled: renaming,
          onChange: (value) => setEditing({ ...editing, value }),
          onCommit: () => void commitRename(),
          onCancel: () => setEditing(null),
        }
      }
      label="workspace files"
      header={
        workspace && (
          <>
            <span
              title={rootDecoration?.label}
              style={{
                color: rootDecoration?.color
                  ? `var(--${rootDecoration.color})`
                  : undefined,
              }}
            >
              {workspace?.name ?? 'workspace'}
            </span>
            <IconButton
              aria-label="new workspace file"
              title="new file"
              onClick={() => void create('new-file')}
            >
              <FilePlus2 size={14} />
            </IconButton>
            <IconButton
              aria-label="new workspace folder"
              title="new folder"
              onClick={() => void create('new-folder')}
            >
              <FolderPlus size={14} />
            </IconButton>
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
