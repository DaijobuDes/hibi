import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, type DesktopApi } from '../shared/desktop'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('hibi', {
    getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  } satisfies DesktopApi)
}
