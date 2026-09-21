import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, BrowserWindow, net, shell } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { HISTORY_CHANNELS } from '../shared/history'
import {
  newerUpdate,
  UPDATE_CHANNELS,
  UPDATE_URL,
  type UpdateRelease,
  type UpdateState,
  updateChannel,
  updateRelease,
} from '../shared/updates'

let state: UpdateState = {
  channel: 'nightly-green',
  status: 'idle',
  supported: false,
  manualInstall: process.platform === 'darwin',
  message: 'Updates are available in installed builds.',
}
let release: UpdateRelease | undefined
let updater: AppUpdater | undefined
let installer: string | undefined
let installRequested = false
let busy = false
const unsupportedMessage =
  'Updates require an installed macOS or Windows build, or a running Linux AppImage.'
const preferencePath = () =>
  join(app.getPath('userData'), 'update-channel.json')
export const getUpdateState = () => ({ ...state })

async function clearInstaller() {
  if (installer)
    await rm(dirname(installer), { recursive: true, force: true }).catch(
      () => {},
    )
  installer = undefined
}

function publish(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send(UPDATE_CHANNELS.changed, getUpdateState())
}

async function run(action: () => Promise<void>) {
  if (busy || installRequested)
    throw new Error('Wait for the current update action to finish.')
  busy = true
  try {
    await action()
  } catch (error) {
    publish({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'The update failed. Try again.',
    })
  } finally {
    busy = false
  }
  return getUpdateState()
}

export async function loadUpdates() {
  try {
    state.channel = updateChannel(
      JSON.parse(await readFile(preferencePath(), 'utf8')),
    )
  } catch {
    /* Missing or old preferences use the recommended channel. */
  }
  state.supported =
    app.isPackaged &&
    ((process.platform === 'darwin' &&
      ['arm64', 'x64'].includes(process.arch)) ||
      (process.platform === 'win32' && process.arch === 'x64') ||
      (process.platform === 'linux' &&
        process.arch === 'x64' &&
        !!process.env.APPIMAGE))
  state.message = state.supported
    ? 'Hibi checks for updates automatically. You choose when to download and install.'
    : unsupportedMessage
}

export function startUpdateChecks() {
  if (!state.supported) return
  const check = () => {
    if (!busy && !installRequested && ['idle', 'error'].includes(state.status))
      void checkForUpdates().catch(() => {})
  }
  setTimeout(check, 15_000).unref()
  setInterval(check, 6 * 60 * 60 * 1000).unref()
}

export function setUpdateChannel(input: unknown) {
  const channel = updateChannel(input)
  return run(async () => {
    await writeFile(`${preferencePath()}.tmp`, JSON.stringify(channel), {
      mode: 0o600,
    })
    await rename(`${preferencePath()}.tmp`, preferencePath())
    await clearInstaller()
    release = undefined
    publish({
      channel,
      status: 'idle',
      version: undefined,
      broken: undefined,
      progress: undefined,
      message: state.supported
        ? 'Update channel saved. Check for updates to see the latest build.'
        : unsupportedMessage,
    })
  })
}

export function checkForUpdates() {
  return run(async () => {
    if (!state.supported)
      throw new Error(
        'Updates are available only in supported installed builds.',
      )
    release = undefined
    await clearInstaller()
    publish({
      status: 'checking',
      version: undefined,
      broken: undefined,
      progress: undefined,
      message: 'Checking for updates…',
    })
    const response = await net.fetch(
      `${UPDATE_URL}${state.channel}/update.json`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (response.status === 404)
      throw new Error(
        'No build is available on this channel yet. Try again later.',
      )
    if (!response.ok)
      throw new Error(
        `Could not check for updates (HTTP ${response.status}). Try again.`,
      )
    const candidate = updateRelease(await response.json(), state.channel)
    if (!candidate.assets[`${process.platform}-${process.arch}`])
      throw new Error('This update has no download for your system.')
    if (!newerUpdate(candidate.version, app.getVersion())) {
      publish({
        status: 'idle',
        message: 'No newer build is available on this channel.',
      })
      return
    }
    release = candidate
    publish({
      status: 'available',
      version: candidate.version,
      broken: candidate.status === 'nightly-broken',
      message:
        'An update is available. Save and back up your documents before installing.',
    })
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(
        HISTORY_CHANNELS.notice,
        'A Hibi update is available. Open Settings → Hibi → Updates.',
      )
  })
}

async function desktopUpdater() {
  if (!updater) {
    const module = await import('electron-updater')
    updater = module.default.autoUpdater
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = true
    updater.disableDifferentialDownload = true
    updater.on('error', () => {
      if (installRequested)
        publish({
          status: 'error',
          message: 'Could not install the update. Download it again and retry.',
        })
    })
    updater.on('download-progress', ({ percent }) =>
      publish({ progress: Math.floor(percent) }),
    )
  }
  return updater
}

export function downloadUpdate() {
  return run(async () => {
    if (!release || !['available', 'error'].includes(state.status))
      throw new Error('Check for updates before downloading.')
    publish({
      status: 'downloading',
      progress: 0,
      message: 'Downloading update…',
    })
    const base = `${UPDATE_URL}${release.tag}/`
    if (state.manualInstall) {
      const asset = release.assets[`${process.platform}-${process.arch}`]
      if (!asset)
        throw new Error('This update has no download for your system.')
      const directory = await mkdtemp(join(app.getPath('temp'), 'hibi-update-'))
      const destination = join(directory, asset.name)
      try {
        const response = await net.fetch(`${base}${asset.name}`, {
          signal: AbortSignal.timeout(30 * 60_000),
        })
        if (!response.ok || !response.body)
          throw new Error('Could not download the installer. Try again.')
        const hash = createHash('sha512')
        let received = 0
        let progress = -1
        await pipeline(
          Readable.fromWeb(response.body as never),
          new Transform({
            transform(chunk, _encoding, callback) {
              received += chunk.length
              if (received > asset.size)
                return callback(
                  new Error('The update download has an unexpected size.'),
                )
              hash.update(chunk)
              const next = Math.floor((received / asset.size) * 100)
              if (next !== progress) {
                progress = next
                publish({ progress })
              }
              callback(null, chunk)
            },
          }),
          createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
        )
        if (received !== asset.size || hash.digest('base64') !== asset.sha512)
          throw new Error(
            'The update download could not be verified. Try downloading again.',
          )
        installer = destination
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    } else {
      const client = await desktopUpdater()
      client.setFeedURL({
        provider: 'generic',
        url: base,
        channel: 'latest',
        useMultipleRangeRequest: false,
      })
      // Our run-number comparison already rejected older builds. Semver sorts Git hashes incorrectly.
      client.allowDowngrade = true
      const result = await client.checkForUpdates()
      const asset = release.assets[`${process.platform}-${process.arch}`]
      const files = result?.updateInfo.files
      if (
        !result?.isUpdateAvailable ||
        result.updateInfo.version !== release.version ||
        !asset ||
        files?.length !== 1 ||
        files[0]?.url !== asset.name ||
        files[0]?.sha512 !== asset.sha512 ||
        files[0]?.size !== asset.size
      )
        throw new Error('The update metadata changed. Check for updates again.')
      await client.downloadUpdate()
    }
    publish({
      status: 'downloaded',
      progress: 100,
      message: state.manualInstall
        ? 'Open the installer, quit Hibi, then drag Hibi into Applications to replace it.'
        : 'The update is ready. Restart Hibi to install it.',
    })
  })
}

export async function installUpdate() {
  if (busy || installRequested || state.status !== 'downloaded')
    throw new Error('Download an update before installing.')
  if (state.manualInstall) {
    if (!installer) throw new Error('Download the installer again.')
    const error = await shell.openPath(installer)
    if (error) throw new Error('Could not open the installer. Try again.')
  } else {
    installRequested = true
    app.quit()
  }
}

export function cancelUpdateInstall() {
  installRequested = false
}
export function finishUpdateInstall() {
  if (!installRequested || !updater) return undefined
  updater.quitAndInstall(false, true)
  installRequested = false
  return state.status !== 'error'
}
