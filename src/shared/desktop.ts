export const APP_INFO_CHANNEL = 'app:info'
export const DOCUMENT_CHANNELS = {
  get: 'document:get',
  update: 'document:update',
  open: 'document:open',
  new: 'document:new',
  save: 'document:save',
  command: 'document:command',
} as const

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
export type DocumentState = {
  markdown: string
  savedMarkdown: string
  name: string
  dirty: boolean
  revision: number
}
export type DocumentCommand = 'new' | 'open' | 'save' | 'saveAs'

export type AppInfo = {
  version: string
  electron: string
  platform: string
}

export type DesktopApi = {
  getAppInfo: () => Promise<AppInfo>
  getDocument: () => Promise<DocumentState>
  updateDocument: (markdown: string) => Promise<void>
  openDocument: () => Promise<DocumentState | null>
  newDocument: () => Promise<DocumentState | null>
  saveDocument: (saveAs: boolean) => Promise<DocumentState | null>
  onDocumentCommand: (
    callback: (command: DocumentCommand) => void,
  ) => () => void
}
