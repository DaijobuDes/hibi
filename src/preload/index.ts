import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { ADDON_CHANNELS } from '../addons/api'
import { ABOUT_CHANNELS } from '../shared/about'
import { APPEARANCE_CHANNEL } from '../shared/colorschemes'
import {
  APP_INFO_CHANNEL,
  type DesktopApi,
  DOCUMENT_CHANNELS,
} from '../shared/desktop'
import { HISTORY_CHANNELS } from '../shared/history'
import { type AppCommand, HOTKEY_CHANNELS } from '../shared/hotkeys'
import { MEDIA_CHANNELS } from '../shared/media'
import { SIDELOAD_CHANNELS } from '../shared/sideload'
import { WORKSPACE_CHANNELS, type WorkspaceState } from '../shared/workspace'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('hibi', {
    navigateDocument: (direction) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.navigate, direction),
    openDocumentLink: (href, revision) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.link, href, revision),
    openRemoteDocument: (url) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.remote, url),
    onOpenRemote: (callback) => {
      const listener = () => callback()
      ipcRenderer.on(DOCUMENT_CHANNELS.requestRemote, listener)
      return () => {
        ipcRenderer.removeListener(DOCUMENT_CHANNELS.requestRemote, listener)
      }
    },
    attachMedia: (files, revision) =>
      ipcRenderer.invoke(
        MEDIA_CHANNELS.attach,
        files === null
          ? null
          : files.map((file) => webUtils.getPathForFile(file)),
        revision,
      ),
    readDocumentMedia: (source, revision) =>
      ipcRenderer.invoke(MEDIA_CHANNELS.read, source, revision),
    openDroppedFile: (file) =>
      ipcRenderer.invoke(MEDIA_CHANNELS.open, webUtils.getPathForFile(file)),
    getInstalledAddons: () => ipcRenderer.invoke(SIDELOAD_CHANNELS.list),
    installAddon: (url) => ipcRenderer.invoke(SIDELOAD_CHANNELS.install, url),
    openAddonsFolder: () => ipcRenderer.invoke(SIDELOAD_CHANNELS.folder),
    openAddonGarden: () => ipcRenderer.invoke(SIDELOAD_CHANNELS.garden),
    removeAddon: (id) => ipcRenderer.invoke(SIDELOAD_CHANNELS.remove, id),
    listVersions: () => ipcRenderer.invoke(HISTORY_CHANNELS.list),
    previewVersion: (id) => ipcRenderer.invoke(HISTORY_CHANNELS.preview, id),
    restoreVersion: (id) => ipcRenderer.invoke(HISTORY_CHANNELS.restore, id),
    onNotice: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string) =>
        callback(message)
      ipcRenderer.on(HISTORY_CHANNELS.notice, listener)
      return () => {
        ipcRenderer.removeListener(HISTORY_CHANNELS.notice, listener)
      }
    },
    getLicenses: () => ipcRenderer.invoke(ABOUT_CHANNELS.licenses),
    getLicense: (id) => ipcRenderer.invoke(ABOUT_CHANNELS.license, id),
    openSponsor: () => ipcRenderer.invoke(ABOUT_CHANNELS.sponsor),
    setAppearance: (appearance) =>
      ipcRenderer.invoke(APPEARANCE_CHANNEL, appearance),
    getAddonStates: () => ipcRenderer.invoke(ADDON_CHANNELS.states),
    setAddonEnabled: (id, enabled) =>
      ipcRenderer.invoke(ADDON_CHANNELS.enable, id, enabled),
    invokeAddon: (id, method, input) =>
      ipcRenderer.invoke(ADDON_CHANNELS.invoke, id, method, input),
    queryAddon: (id, method, input) =>
      ipcRenderer.invoke(ADDON_CHANNELS.query, id, method, input),
    getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
    getRecentWorkspaces: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.recent),
    openRecentWorkspace: (id) =>
      ipcRenderer.invoke(WORKSPACE_CHANNELS.openRecent, id),
    getWorkspaceSnapshot: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.snapshot),
    workspaceAction: (action) =>
      ipcRenderer.invoke(WORKSPACE_CHANNELS.action, action),
    openWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.open),
    refreshWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.refresh),
    openWorkspaceFile: (path) =>
      ipcRenderer.invoke(WORKSPACE_CHANNELS.openFile, path),
    onWorkspaceChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        workspace: WorkspaceState | null,
      ) => callback(workspace)
      ipcRenderer.on(WORKSPACE_CHANNELS.changed, listener)
      return () => {
        ipcRenderer.removeListener(WORKSPACE_CHANNELS.changed, listener)
      }
    },
    getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
    getDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.get),
    updateDocument: (markdown) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.update, markdown),
    openDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.open),
    newDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.new),
    saveDocument: (saveAs) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.save, saveAs),
    autosaveDocument: (revision) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.autosave, revision),
    renameDocument: (name) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.rename, name),
    readDocumentImage: (source, revision) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.image, source, revision),
    getHotkeys: () => ipcRenderer.invoke(HOTKEY_CHANNELS.get),
    saveHotkeys: (hotkeys) => ipcRenderer.invoke(HOTKEY_CHANNELS.save, hotkeys),
    setHotkeyRecording: (recording) =>
      ipcRenderer.invoke(HOTKEY_CHANNELS.record, recording),
    onCommand: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        command: AppCommand,
      ) => callback(command)
      ipcRenderer.on(HOTKEY_CHANNELS.command, listener)
      return () => {
        ipcRenderer.removeListener(HOTKEY_CHANNELS.command, listener)
      }
    },
  } satisfies DesktopApi)
}
