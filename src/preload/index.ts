import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_INFO_CHANNEL,
  type DesktopApi,
  DOCUMENT_CHANNELS,
} from '../shared/desktop'
import { type AppCommand, HOTKEY_CHANNELS } from '../shared/hotkeys'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('hibi', {
    getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
    getDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.get),
    updateDocument: (markdown) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.update, markdown),
    openDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.open),
    newDocument: () => ipcRenderer.invoke(DOCUMENT_CHANNELS.new),
    saveDocument: (saveAs) =>
      ipcRenderer.invoke(DOCUMENT_CHANNELS.save, saveAs),
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
