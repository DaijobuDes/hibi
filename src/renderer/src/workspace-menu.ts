import type {
  WorkspaceAction,
  WorkspaceActionResult,
  WorkspaceEntry,
} from '../../shared/workspace'
import type { DialogApi } from '../../ui/dialogs'
import type { MenuItem } from '../../ui/menus'

export type WorkspaceRename = { id: string; value: string } | null

export function workspaceMenuItems(
  entry: WorkspaceEntry,
  {
    dialogs,
    onAction,
    create,
    rename,
  }: {
    dialogs: DialogApi
    onAction: (action: WorkspaceAction) => Promise<WorkspaceActionResult | null>
    create: (kind: 'new-file' | 'new-folder', parent: string) => Promise<void>
    rename: (target: WorkspaceRename) => void
  },
): MenuItem[] {
  const path = entry.path
  return [
    ...(entry.kind === 'folder'
      ? [
          {
            id: 'new-file',
            label: 'New file',
            onSelect: () => create('new-file', path),
          },
          {
            id: 'new-folder',
            label: 'New folder',
            onSelect: () => create('new-folder', path),
          },
        ]
      : []),
    {
      id: 'rename',
      label: 'Rename',
      onSelect: () => rename({ id: path, value: entry.name }),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      onSelect: async () => {
        await onAction({ action: 'duplicate', path })
      },
    },
    ...(['copy', 'move'] as const).map((action) => ({
      id: action,
      label: `${action} to…`,
      async onSelect() {
        const destination = await dialogs.prompt({
          title: `${action} ${entry.name}`,
          label: 'Destination path',
          description:
            'Relative to this workspace, including the file or folder name.',
          defaultValue: path,
        })
        if (destination !== null) await onAction({ action, path, destination })
      },
    })),
    {
      id: 'copy-path',
      label: 'Copy relative path',
      onSelect: () => navigator.clipboard.writeText(path),
    },
    {
      id: 'delete',
      label: 'Move to trash',
      separatorBefore: true,
      async onSelect() {
        if (
          await dialogs.confirm({
            title: `Move ${entry.name} to trash?`,
            description:
              entry.kind === 'folder'
                ? 'This includes every file and folder inside it.'
                : 'You can recover it from the system trash.',
            confirmLabel: 'Move to trash',
          })
        )
          await onAction({ action: 'delete', path })
      },
    },
  ]
}
