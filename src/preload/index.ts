import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_INFO_CHANNEL,
  type DesktopApi,
  DOCUMENT_CHANNELS,
  type DocumentCommand,
} from '../shared/desktop'

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
    onDocumentCommand: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        command: DocumentCommand,
      ) => callback(command)
      ipcRenderer.on(DOCUMENT_CHANNELS.command, listener)
      return () => {
        ipcRenderer.removeListener(DOCUMENT_CHANNELS.command, listener)
      }
    },
  } satisfies DesktopApi)
}
