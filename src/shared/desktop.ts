export const APP_INFO_CHANNEL = 'app:info'
export const DOCUMENT_CHANNELS = {
  get: 'document:get',
  update: 'document:update',
  open: 'document:open',
  new: 'document:new',
  save: 'document:save',
  rename: 'document:rename',
  image: 'document:image',
} as const

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
export type DocumentState = {
  /** Opaque identity for per-file preferences. Contains no filesystem path. */
  id: string
  /** Workspace draft with a target name but no file on disk yet. */
  ephemeral: boolean
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
  getInstalledAddons: () => Promise<import('./sideload').InstalledAddon[]>
  installAddon: () => Promise<void>
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
  getWorkspaceSnapshot: () => Promise<import('./workspace').WorkspaceSnapshot>
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
  getDocument: () => Promise<DocumentState>
  updateDocument: (markdown: string) => Promise<void>
  openDocument: () => Promise<DocumentState | null>
  newDocument: () => Promise<DocumentState | null>
  saveDocument: (saveAs: boolean) => Promise<DocumentState | null>
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
