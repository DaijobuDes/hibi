export const APP_INFO_CHANNEL = 'app:info'
export const DOCUMENT_CHANNELS = {
  get: 'document:get',
  update: 'document:update',
  open: 'document:open',
  external: 'document:external',
  externalPending: 'document:external-pending',
  new: 'document:new',
  save: 'document:save',
  autosave: 'document:autosave',
  selectTab: 'document:select-tab',
  closeTab: 'document:close-tab',
  moveTab: 'document:move-tab',
  tabsEnabled: 'document:tabs-enabled',
  rename: 'document:rename',
  image: 'document:image',
  navigate: 'document:navigate',
  link: 'document:link',
  remote: 'document:remote',
  requestRemote: 'document:request-remote',
} as const

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
export type DocumentState = {
  /** Stable window-local tab identity, including across save and rename. */
  tabId: string
  tabs: DocumentTab[]
  /** False keeps only the active document open. */
  tabsEnabled: boolean
  /** Opaque identity for per-file preferences. Contains no filesystem path. */
  id: string
  /** Workspace draft with a target name but no file on disk yet. */
  ephemeral: boolean
  markdown: string
  savedMarkdown: string
  name: string
  dirty: boolean
  revision: number
  /** True only after this document has a real local save destination. */
  canAutosave: boolean
}
export type DocumentTab = { id: string; name: string; dirty: boolean }
export type AutosaveResult = {
  status: 'saved' | 'skipped' | 'conflict'
  document: DocumentState | null
}
export type DocumentCommand = 'new' | 'open' | 'save' | 'saveAs'

export type AppInfo = {
  version: string
  electron: string
  platform: string
}

export type DesktopApi = {
  getFileAssociations: () => Promise<
    import('./file-associations').FileAssociationState
  >
  setFileAssociation: (format: string) => Promise<void>
  navigateDocument: (
    direction: 'back' | 'forward',
  ) => Promise<DocumentState | null>
  openDocumentLink: (
    href: string,
    revision: number,
  ) => Promise<DocumentState | null>
  openRemoteDocument: (url: string) => Promise<DocumentState | null>
  onOpenRemote: (callback: () => void) => () => void
  attachMedia: (
    files: File[] | null,
    revision: number,
  ) => Promise<import('./media').AttachmentResult | null>
  readDocumentMedia: (
    source: string,
    revision: number,
  ) => Promise<import('./media').DocumentMedia | null>
  openDroppedFile: (file: File) => Promise<{
    document: DocumentState | null
    workspace?: WorkspaceState | null
  } | null>
  getInstalledAddons: () => Promise<import('./sideload').InstalledAddon[]>
  installAddon: (url?: string) => Promise<void>
  openAddonsFolder: () => Promise<void>
  openAddonGarden: () => Promise<void>
  removeAddon: (id: string) => Promise<void>
  listVersions: () => Promise<import('./history').DocumentVersion[]>
  previewVersion: (id: string) => Promise<string>
  restoreVersion: (id: string) => Promise<DocumentState | null>
  onNotice: (callback: (message: string) => void) => () => void
  getLicenses: () => Promise<import('./about').LicenseInfo[]>
  getLicense: (id: string) => Promise<string>
  openSponsor: () => Promise<void>
  setAppearance: (
    appearance: import('./colorschemes').NativeAppearance,
  ) => Promise<void>
  getAddonStates: () => Promise<AddonState[]>
  setAddonEnabled: (id: string, enabled: boolean) => Promise<AddonState[]>
  invokeAddon: (id: string, method: string, input?: unknown) => Promise<unknown>
  queryAddon: (id: string, method: string, input?: unknown) => Promise<unknown>
  getWorkspace: () => Promise<WorkspaceState | null>
  getRecentWorkspaces: () => Promise<import('./workspace').RecentWorkspace[]>
  openRecentWorkspace: (id: string) => Promise<WorkspaceState | null>
  getWorkspaceSnapshot: () => Promise<import('./workspace').WorkspaceSnapshot>
  getWorkspaceIndex: () => Promise<import('./workspace').WorkspaceIndex | null>
  workspaceAction: (
    action: import('./workspace').WorkspaceAction,
  ) => Promise<import('./workspace').WorkspaceActionResult | null>
  openWorkspace: () => Promise<WorkspaceState | null>
  refreshWorkspace: () => Promise<WorkspaceState | null>
  openWorkspaceFile: (path: string) => Promise<DocumentState | null>
  onWorkspaceChanged: (
    callback: (workspace: WorkspaceState | null) => void,
  ) => () => void
  getAppInfo: () => Promise<AppInfo>
  setUiCase: (value: import('./ui-case').UiCase) => Promise<void>
  getDocument: () => Promise<DocumentState>
  selectDocumentTab: (id: string) => Promise<DocumentState>
  closeDocumentTab: (id: string) => Promise<DocumentState | null>
  moveDocumentTab: (
    id: string,
    beforeId: string | null,
  ) => Promise<DocumentState>
  setTabsEnabled: (enabled: boolean) => Promise<DocumentState>
  updateDocument: (markdown: string) => Promise<void>
  openDocument: () => Promise<DocumentState | null>
  openExternalDocuments: () => Promise<{
    document: DocumentState | null
    errors: string[]
  }>
  onExternalDocuments: (callback: () => void) => () => void
  newDocument: () => Promise<DocumentState | null>
  saveDocument: (saveAs: boolean) => Promise<DocumentState | null>
  autosaveDocument: (revision: number) => Promise<AutosaveResult>
  renameDocument: (name: string) => Promise<DocumentState>
  readDocumentImage: (
    source: string,
    revision: number,
  ) => Promise<string | null>
  getHotkeys: () => Promise<Hotkeys>
  saveHotkeys: (hotkeys: Hotkeys) => Promise<Hotkeys>
  setHotkeyRecording: (recording: boolean) => Promise<void>
  onCommand: (callback: (command: AppCommand) => void) => () => void
}

import type { AddonState } from '../addons/api'
import type { AppCommand, Hotkeys } from './hotkeys'
import type { WorkspaceState } from './workspace'
