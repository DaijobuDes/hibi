export const QUICK_NOTE_CHANNELS = {
  destination: 'quick-note:destination',
  save: 'quick-note:save',
} as const

export type QuickNoteRequest = {
  workspaceId: string
  folder: string
  title: string
  markdown: string
}

/** The only desktop requests available to the capture window. */
export type QuickNoteBridge = {
  /** Resolve the selected workspace, or the current one for an empty id, so the note stays there if the main window switches workspaces. */
  destination: (workspaceId: string) => Promise<{ id: string; path: string }>
  save: (request: QuickNoteRequest) => Promise<{ name: string }>
}
