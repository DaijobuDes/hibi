export const APP_INFO_CHANNEL = 'app:info'

export type AppInfo = {
  version: string
  electron: string
  platform: string
}

export type DesktopApi = {
  getAppInfo: () => Promise<AppInfo>
}
