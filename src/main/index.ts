import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuItemConstructorOptions } from 'electron'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
} from 'electron'
import { APP_INFO_CHANNEL, type AppInfo } from '../shared/desktop'
import {
  CONTENT_SECURITY_POLICY,
  isTrustedRendererUrl,
  resolveAssetPath,
} from './security'

app.setName('hibi')
app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

// Keep development and test profiles separate from installed app data.
if (!app.isPackaged) {
  const testProfile = app.commandLine.getSwitchValue('user-data-dir')
  app.setPath(
    'userData',
    testProfile
      ? resolve(testProfile)
      : join(app.getPath('appData'), 'hibi-dev'),
  )
}

const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererUrl = devUrl ? new URL(devUrl).href : 'app://hibi/'
const rendererRoot = join(import.meta.dirname, '../renderer')
let mainWindow: BrowserWindow | null = null

function titleBarColors() {
  return {
    color: nativeTheme.shouldUseDarkColors ? '#181818' : '#ffffff',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#eeeeee' : '#222222',
    height: 48,
  }
}

async function serveAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  const path = resolveAssetPath(request.url, rendererRoot)
  if (!path) return new Response(null, { status: 403 })
  try {
    const response = await net.fetch(pathToFileURL(path).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'hibi',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 17 } }
      : { titleBarOverlay: titleBarColors(), autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#ffffff',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  })
  mainWindow = window
  window.once('ready-to-show', () => {
    window.show()
  })
  window.on('closed', () => {
    mainWindow = null
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) =>
    event.preventDefault(),
  )
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  )
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer exited:', details.reason, details.exitCode)
    if (details.reason === 'clean-exit' || window.isDestroyed()) return
    void dialog
      .showMessageBox(window, {
        type: 'error',
        message: 'hibi needs to reload.',
        detail: 'the window stopped responding. unsaved changes may be lost.',
        buttons: ['reload', 'quit'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 1) app.quit()
        else if (!window.isDestroyed()) window.reload()
      })
      .catch((error: unknown) => {
        console.error(error)
        app.quit()
      })
  })
  void window.loadURL(rendererUrl).catch((error: unknown) => {
    console.error('failed to load app:', error)
    dialog.showErrorBox(
      'hibi could not start',
      'please restart the app. if this continues, reinstall it.',
    )
    app.quit()
  })
}

function installMenu(): void {
  const menu: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'view',
      submenu: [
        ...(!app.isPackaged
          ? [
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const },
            ]
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow()
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  void app
    .whenReady()
    .then(() => {
      protocol.handle('app', serveAsset)
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      )
      session.defaultSession.on('will-download', (event) =>
        event.preventDefault(),
      )

      if (devUrl) {
        const websocketOrigin = new URL(devUrl).origin.replace(/^http/, 'ws')
        const devPolicy = CONTENT_SECURITY_POLICY.replace(
          "script-src 'self'",
          "script-src 'self' 'unsafe-inline'",
        )
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace(
            "connect-src 'self'",
            `connect-src 'self' ${websocketOrigin}`,
          )
        session.defaultSession.webRequest.onHeadersReceived(
          { urls: [`${new URL(devUrl).origin}/*`] },
          (details, callback) => {
            callback({
              responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [devPolicy],
              },
            })
          },
        )
      }

      ipcMain.handle(APP_INFO_CHANNEL, (event): AppInfo => {
        if (
          event.sender !== mainWindow?.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
        ) {
          throw new Error('untrusted ipc sender')
        }
        return {
          version: app.getVersion(),
          electron: process.versions.electron,
          platform: process.platform,
        }
      })
      installMenu()
      nativeTheme.on('updated', () => {
        if (process.platform !== 'darwin')
          mainWindow?.setTitleBarOverlay(titleBarColors())
      })
      createWindow()
    })
    .catch((error: unknown) => {
      console.error('startup failed:', error)
      dialog.showErrorBox(
        'hibi could not start',
        'please restart the app. if this continues, reinstall it.',
      )
      app.quit()
    })
}
