export const WORKSPACE_CHANNELS = {
  get: 'workspace:get',
  open: 'workspace:open',
  refresh: 'workspace:refresh',
  openFile: 'workspace:open-file',
  changed: 'workspace:changed',
  action: 'workspace:action',
  snapshot: 'workspace:snapshot',
} as const

export type WorkspaceEntry = {
  path: string
  name: string
  kind: 'file' | 'folder'
  children?: WorkspaceEntry[]
}

export type WorkspaceState = {
  name: string
  entries: WorkspaceEntry[]
  activePath: string | null
}

export type WorkspaceAction = {
  action:
    | 'new-file'
    | 'new-folder'
    | 'rename'
    | 'copy'
    | 'move'
    | 'duplicate'
    | 'delete'
  /** Relative source path, or parent directory for new entries. Empty = root. */
  path: string
  /** New basename for rename; complete relative destination for copy/move. */
  destination?: string
}
export type WorkspaceActionResult = {
  workspace: WorkspaceState | null
  document: import('./desktop').DocumentState
  path: string
}

export type WorkspacePage = {
  id?: string
  path: string
  markdown: string
  /** Pre-rendered by the enabled flavor pipeline. Always sanitized by the site. */
  html?: string
  /** Local Markdown image references mapped to embedded image data URLs. */
  images?: Record<string, string>
}
export type WorkspaceSnapshot = {
  css?: string
  name: string
  pages: WorkspacePage[]
  appearance?: import('./colorschemes').ThemePreferences
}
