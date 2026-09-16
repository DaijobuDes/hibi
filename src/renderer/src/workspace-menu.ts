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
            label: 'new file',
            onSelect: () => create('new-file', path),
          },
          {
            id: 'new-folder',
            label: 'new folder',
            onSelect: () => create('new-folder', path),
          },
        ]
      : []),
    {
      id: 'rename',
      label: 'rename',
      onSelect: () => rename({ id: path, value: entry.name }),
    },
    {
      id: 'duplicate',
      label: 'duplicate',
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
          label: 'destination path',
          description:
            'relative to this workspace, including the file or folder name.',
          defaultValue: path,
        })
        if (destination !== null) await onAction({ action, path, destination })
      },
    })),
    {
      id: 'copy-path',
      label: 'copy relative path',
      onSelect: () => navigator.clipboard.writeText(path),
    },
    {
      id: 'delete',
      label: 'move to trash',
      separatorBefore: true,
      async onSelect() {
        if (
          await dialogs.confirm({
            title: `move ${entry.name} to trash?`,
            description:
              entry.kind === 'folder'
                ? 'this includes every file and folder inside it.'
                : 'you can recover it from the system trash.',
            confirmLabel: 'move to trash',
          })
        )
          await onAction({ action: 'delete', path })
      },
    },
  ]
}
