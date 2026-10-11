import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  type Rectangle,
  screen,
} from 'electron'
import { appearanceColors } from '../../main/appearance'
import { isTrustedRendererUrl } from '../../main/security'
import { QUICK_NOTE_CHANNELS, type QuickNoteBridge } from './ipc'

const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const url = new URL('quick-note.html', devUrl ?? 'app://hibi/').href
const testing = !app.isPackaged && app.commandLine.hasSwitch('hibi-test')
const boundsPath = () => join(app.getPath('userData'), 'quick-note-window.json')
let current: BrowserWindow | null = null
let opening: Promise<void> | null = null
let handlers: Pick<QuickNoteBridge, 'destination' | 'save'> | null = null

async function savedBounds(): Promise<Record<string, Rectangle>> {
  try {
    const value: unknown = JSON.parse(await readFile(boundsPath(), 'utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, Rectangle>
  } catch {
    // Missing or damaged positions fall back to the default placement.
  }
  return {}
}

function fits(bounds: Rectangle | undefined, area: Rectangle) {
  return (
    !!bounds &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  )
}

/** Open on the display under the pointer, where the window was last left there. */
function placement(saved: Record<string, Rectangle>): Rectangle {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const previous = saved[display.id]
  if (previous && fits(previous, area)) return previous
  const width = Math.min(520, area.width)
  const height = Math.min(360, area.height)
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height * 0.18),
    width,
    height,
  }
}

async function rememberBounds(bounds: Rectangle) {
  const saved = await savedBounds()
  saved[screen.getDisplayMatching(bounds).id] = bounds
  const path = boundsPath()
  await writeFile(`${path}.tmp`, JSON.stringify(saved), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

function trusted(event: IpcMainInvokeEvent) {
  if (
    !current ||
    event.sender !== current.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, url)
  )
    throw new Error('untrusted ipc sender')
  if (!handlers) throw new Error('Quick note is not available.')
  return handlers
}

function listen() {
  if (handlers) return
  ipcMain.handle(QUICK_NOTE_CHANNELS.destination, (event, id: unknown) =>
    trusted(event).destination(id as string),
  )
  ipcMain.handle(QUICK_NOTE_CHANNELS.save, (event, request: unknown) =>
    trusted(event).save(request as never),
  )
}

async function create() {
  const bounds = placement(await savedBounds())
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 260,
    show: false,
    // Linux cannot change focusability after creation; CI shows test windows.
    focusable: !testing || process.platform === 'linux',
    title: 'Quick note',
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // A macOS panel floats over full-screen apps on every space and takes
    // keyboard focus without activating Hibi or raising its main window.
    ...(process.platform === 'darwin'
      ? { type: 'panel' }
      : { alwaysOnTop: true, skipTaskbar: true }),
    backgroundColor: appearanceColors().background,
    webPreferences: {
      // This module is a lazy chunk, so resolve from the app root.
      preload: join(app.getAppPath(), 'out/preload/quick-note.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  })
  current = window
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, url))
      event.preventDefault()
  })
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  )
  window.once('ready-to-show', () => {
    if (!testing) window.show()
  })
  window.on('close', () => {
    void rememberBounds(window.getBounds()).catch((error: unknown) =>
      console.error('could not remember quick note window position:', error),
    )
  })
  window.on('closed', () => {
    if (current === window) current = null
  })
  await window.loadURL(url)
}

/** Show the single capture window, creating it on first use. */
export async function openCaptureWindow(
  requests: Pick<QuickNoteBridge, 'destination' | 'save'>,
) {
  listen()
  handlers = requests
  if (current && !current.isDestroyed()) {
    if (!testing) {
      current.show()
      current.focus()
    }
    return
  }
  opening ??= create().finally(() => {
    opening = null
  })
  await opening
}

export function closeCaptureWindow() {
  current?.close()
}
