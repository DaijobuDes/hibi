import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
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
import { ADDON_CHANNELS } from '../addons/api'
import { APPEARANCE_CHANNEL } from '../shared/colorschemes'
import {
  APP_INFO_CHANNEL,
  type AppInfo,
  DOCUMENT_CHANNELS,
} from '../shared/desktop'
import {
  type AppCommand,
  accelerator,
  actions,
  HOTKEY_CHANNELS,
  shortcutFromEvent,
} from '../shared/hotkeys'
import { WORKSPACE_CHANNELS } from '../shared/workspace'
import { enableAddon, getAddonStates, invokeAddon, loadAddons } from './addons'
import { appearanceColors, loadAppearance, saveAppearance } from './appearance'
import {
  confirmDiscard,
  discardChanges,
  getDocument,
  getDocumentPath,
  newDocument,
  openDocument,
  renameDocument,
  saveDocument,
  updateDocument,
} from './document'
import { hotkeys, loadHotkeys, saveHotkeys } from './hotkeys'
import { readDocumentImage } from './images'
import {
  CONTENT_SECURITY_POLICY,
  isTrustedRendererUrl,
  resolveAssetPath,
} from './security'
import {
  getWorkspace,
  observeWorkspace,
  openWorkspace,
  openWorkspaceFile,
  refreshWorkspace,
  workspaceRoot,
} from './workspace'

app.setName('hibi')
app.enableSandbox()
const testing = !app.isPackaged && app.commandLine.hasSwitch('hibi-test')
if (testing && process.platform === 'darwin')
  app.setActivationPolicy('accessory')
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
let fileOperation: Promise<unknown> | null = null
let quitting = false
let recordingHotkey = false
app.on('before-quit', () => {
  quitting = true
})

function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  ) {
    throw new Error('untrusted ipc sender')
  }
  return mainWindow
}

function runFileOperation<T>(
  event: IpcMainInvokeEvent,
  operation: (window: BrowserWindow) => Promise<T>,
) {
  const window = trustedWindow(event)
  if (fileOperation) throw new Error('another file operation is in progress.')
  const pending = operation(window).finally(() => {
    fileOperation = null
  })
  fileOperation = pending
  return pending
}

function titleBarColors() {
  return {
    color: appearanceColors().background,
    symbolColor: appearanceColors().foreground,
    height: 36,
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
    focusable: !testing,
    title: 'hibi',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: titleBarColors(), autoHideMenuBar: true }),
    backgroundColor: appearanceColors().background,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: !testing,
    },
  })
  mainWindow = window
  const stopRecording = () => {
    recordingHotkey = false
    window.webContents.setIgnoreMenuShortcuts(false)
  }
  window.on('blur', stopRecording)
  window.webContents.on('did-start-loading', stopRecording)
  window.webContents.on('before-input-event', (event, input) => {
    if (recordingHotkey || input.type !== 'keyDown' || input.isComposing) return
    const shortcut = shortcutFromEvent({
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      altKey: input.alt,
      shiftKey: input.shift,
    })
    const action =
      shortcut && actions.find(({ id }) => hotkeys[id] === shortcut)
    if (action) {
      event.preventDefault()
      if (!input.isAutoRepeat)
        window.webContents.send(HOTKEY_CHANNELS.command, action.id)
    }
  })
  let allowClose = false
  let confirmingClose = false
  window.on('close', (event) => {
    if (allowClose || (!getDocument().dirty && !fileOperation)) return
    event.preventDefault()
    if (confirmingClose) return
    confirmingClose = true
    void (async () => {
      await fileOperation?.catch(() => undefined)
      if (await confirmDiscard(window)) {
        discardChanges()
        allowClose = true
        if (quitting) app.quit()
        else window.close()
      } else {
        quitting = false
      }
    })()
      .catch((error: unknown) => {
        quitting = false
        dialog.showErrorBox(
          'could not save document',
          error instanceof Error ? error.message : 'please try again.',
        )
      })
      .finally(() => {
        confirmingClose = false
      })
  })
  window.once('ready-to-show', () => {
    if (testing) return
    if (!app.isPackaged && app.commandLine.hasSwitch('user-data-dir'))
      window.showInactive()
    else window.show()
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
    // Vite dependency optimization can replace the initial navigation with a reload.
    if (
      !app.isPackaged &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_ABORTED'
    )
      return
    console.error('failed to load app:', error)
    dialog.showErrorBox(
      'hibi could not start',
      'please restart the app. if this continues, reinstall it.',
    )
    app.quit()
  })
}

function installMenu(): void {
  const command = (action: AppCommand) => () =>
    mainWindow?.webContents.send(HOTKEY_CHANNELS.command, action)
  const menu: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'file',
      submenu: [
        {
          label: 'new',
          accelerator: accelerator(hotkeys.new),
          click: command('new'),
        },
        {
          label: 'open…',
          accelerator: accelerator(hotkeys.open),
          click: command('open'),
        },
        {
          label: 'save',
          accelerator: accelerator(hotkeys.save),
          click: command('save'),
        },
        {
          label: 'save as…',
          accelerator: accelerator(hotkeys.saveAs),
          click: command('saveAs'),
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'view',
      submenu: [
        {
          label: 'command palette',
          accelerator: accelerator(hotkeys.palette),
          click: command('palette'),
        },
        {
          label: 'find in note',
          accelerator: accelerator(hotkeys.find),
          click: command('find'),
        },
        {
          label: 'settings',
          accelerator: accelerator(hotkeys.settings),
          click: command('settings'),
        },
        { type: 'separator' },
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
    if (testing) return
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
    .then(async () => {
      await loadHotkeys()
      await loadAddons()
      await loadAppearance()
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
        ).replace("connect-src 'self'", `connect-src 'self' ${websocketOrigin}`)
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
        trustedWindow(event)
        return {
          version: app.getVersion(),
          electron: process.versions.electron,
          platform: process.platform,
        }
      })
      ipcMain.handle(APPEARANCE_CHANNEL, async (event, value: unknown) => {
        const window = trustedWindow(event)
        const saved = saveAppearance(value)
        window.setBackgroundColor(appearanceColors().background)
        if (process.platform !== 'darwin')
          window.setTitleBarOverlay(titleBarColors())
        await saved
      })
      ipcMain.handle(ADDON_CHANNELS.states, (event) => {
        trustedWindow(event)
        return getAddonStates()
      })
      ipcMain.handle(
        ADDON_CHANNELS.enable,
        (event, id: unknown, enabled: unknown) =>
          runFileOperation(event, () => enableAddon(id, enabled)),
      )
      ipcMain.handle(
        ADDON_CHANNELS.invoke,
        (event, id: unknown, method: unknown, input: unknown) =>
          runFileOperation(event, (window) =>
            invokeAddon(window, id, method, input),
          ),
      )
      ipcMain.handle(HOTKEY_CHANNELS.get, (event) => {
        trustedWindow(event)
        return hotkeys
      })
      ipcMain.handle(HOTKEY_CHANNELS.save, async (event, value: unknown) => {
        trustedWindow(event)
        const next = await saveHotkeys(value)
        installMenu()
        return next
      })
      ipcMain.handle(HOTKEY_CHANNELS.record, (event, value: unknown) => {
        const window = trustedWindow(event)
        if (typeof value !== 'boolean')
          throw new Error('invalid recording state.')
        recordingHotkey = value
        window.webContents.setIgnoreMenuShortcuts(value)
      })
      ipcMain.handle(DOCUMENT_CHANNELS.get, (event) => {
        trustedWindow(event)
        return getDocument()
      })
      ipcMain.handle(
        DOCUMENT_CHANNELS.image,
        async (event, source: unknown, revision: unknown) => {
          trustedWindow(event)
          if (typeof source !== 'string' || revision !== getDocument().revision)
            return null
          const path = getDocumentPath()
          const image = await readDocumentImage(source, path)
          return revision === getDocument().revision &&
            path === getDocumentPath()
            ? image
            : null
        },
      )
      ipcMain.handle(WORKSPACE_CHANNELS.get, (event) => {
        trustedWindow(event)
        return getWorkspace()
      })
      ipcMain.handle(WORKSPACE_CHANNELS.open, (event) =>
        runFileOperation(event, openWorkspace),
      )
      ipcMain.handle(WORKSPACE_CHANNELS.refresh, (event) => {
        trustedWindow(event)
        return refreshWorkspace()
      })
      ipcMain.handle(WORKSPACE_CHANNELS.openFile, (event, path: unknown) =>
        runFileOperation(event, (window) => openWorkspaceFile(window, path)),
      )
      observeWorkspace(() =>
        mainWindow?.webContents.send(
          WORKSPACE_CHANNELS.changed,
          getWorkspace(),
        ),
      )
      ipcMain.handle(DOCUMENT_CHANNELS.update, (event, value: unknown) => {
        const window = trustedWindow(event)
        updateDocument(value)
        window.setDocumentEdited(getDocument().dirty)
      })
      ipcMain.handle(DOCUMENT_CHANNELS.open, (event) =>
        runFileOperation(event, openDocument),
      )
      ipcMain.handle(DOCUMENT_CHANNELS.new, (event) =>
        runFileOperation(event, newDocument),
      )
      ipcMain.handle(DOCUMENT_CHANNELS.save, (event, saveAs: unknown) => {
        if (typeof saveAs !== 'boolean') throw new Error('invalid save request')
        return runFileOperation(event, (window) =>
          saveDocument(
            window,
            saveAs,
            join(workspaceRoot() ?? '', getDocument().name),
          ),
        )
      })
      ipcMain.handle(DOCUMENT_CHANNELS.rename, (event, name: unknown) =>
        runFileOperation(event, () => renameDocument(name)),
      )
      installMenu()
      nativeTheme.on('updated', () => {
        mainWindow?.setBackgroundColor(appearanceColors().background)
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
