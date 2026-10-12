import { contextBridge, ipcRenderer } from 'electron'
import {
  ADDON_WINDOW_CHANNELS,
  type AddonWindowBridge,
} from '../shared/addon-windows'

// Addon windows get only their owner's identity and native handlers, never window.hibi.
if (process.isMainFrame)
  contextBridge.exposeInMainWorld('hibiAddonWindow', {
    context: () => ipcRenderer.invoke(ADDON_WINDOW_CHANNELS.context),
    states: () => ipcRenderer.invoke(ADDON_WINDOW_CHANNELS.states),
    close: () => ipcRenderer.invoke(ADDON_WINDOW_CHANNELS.closeSelf),
    query: (method, input) =>
      ipcRenderer.invoke(ADDON_WINDOW_CHANNELS.query, method, input),
    invoke: (method, input) =>
      ipcRenderer.invoke(ADDON_WINDOW_CHANNELS.invoke, method, input),
  } satisfies AddonWindowBridge)
