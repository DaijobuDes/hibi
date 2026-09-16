import { contextBridge, ipcRenderer } from 'electron'
import { ADDON_CHANNELS } from '../addons/api'
import { APPEARANCE_CHANNEL } from '../shared/colorschemes'
import {
  APP_INFO_CHANNEL,
  type DesktopApi,
  DOCUMENT_CHANNELS,
} from '../shared/desktop'
import { type AppCommand, HOTKEY_CHANNELS } from '../shared/hotkeys'
import { WORKSPACE_CHANNELS, type WorkspaceState } from '../shared/workspace'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('hibi', {
    setAppearance: (appearance) =>
      ipcRenderer.invoke(APPEARANCE_CHANNEL, appearance),
    getAddonStates: () => ipcRenderer.invoke(ADDON_CHANNELS.states),
    setAddonEnabled: (id, enabled) =>
      ipcRenderer.invoke(ADDON_CHANNELS.enable, id, enabled),
    invokeAddon: (id, method, input) =>
      ipcRenderer.invoke(ADDON_CHANNELS.invoke, id, method, input),
    getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
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
