import { contextBridge, ipcRenderer } from 'electron'
import { QUICK_NOTE_CHANNELS, type QuickNoteBridge } from './ipc'

// The capture window never receives the general window.hibi bridge.
if (process.isMainFrame)
  contextBridge.exposeInMainWorld('quickNote', {
    destination: (workspaceId) =>
      ipcRenderer.invoke(QUICK_NOTE_CHANNELS.destination, workspaceId),
    save: (request) => ipcRenderer.invoke(QUICK_NOTE_CHANNELS.save, request),
  } satisfies QuickNoteBridge)
