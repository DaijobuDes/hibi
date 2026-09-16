export const WORKSPACE_CHANNELS = {
  get: 'workspace:get',
  open: 'workspace:open',
  refresh: 'workspace:refresh',
  openFile: 'workspace:open-file',
  changed: 'workspace:changed',
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

export type WorkspacePage = {
  path: string
  markdown: string
  /** Local Markdown image references mapped to embedded image data URLs. */
  images?: Record<string, string>
}
export type WorkspaceSnapshot = {
  name: string
  pages: WorkspacePage[]
  appearance?: import('./colorschemes').ThemePreferences
}
