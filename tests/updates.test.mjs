import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  newerUpdate,
  updateChannel,
  updateCheckFrequency,
  updateRelease,
} from '../src/shared/updates.ts'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

const version = '0.2.0'
const tag = 'v0.2.0'
const nightlyVersion = '0.2.1-nightly.20260921.gaaaaaaa.15.1'
const nightlyTag = 'nightly-2026-09-21-aaaaaaa-15-1'
const bytes = Buffer.from('a verified installer')
const sha512 = createHash('sha512').update(bytes).digest('base64')
const manifest = (version = '0.2.0', tag = `v${version}`) => ({
  tag,
  version,
  assets: Object.fromEntries(
    [
      ['win32-x64', 'win-x64.exe'],
      ['linux-x64', 'linux-x86_64.AppImage'],
      ['linux-arm64', 'linux-arm64.AppImage'],
      ['darwin-arm64', 'mac-arm64.dmg'],
      ['darwin-x64', 'mac-x64.dmg'],
    ].map(([platform, suffix]) => [
      platform,
      {
        name: `hibi-${version}-${suffix}`,
        sha512,
        size: bytes.length,
        ...(platform.startsWith('darwin-') && {
          zip: {
            name: `hibi-${version}-mac-${platform.slice(7)}.zip`,
            sha512,
            size: bytes.length,
          },
        }),
      },
    ]),
  ),
})

test('channels and feeds accept only beta releases or matching nightly identities', () => {
  for (const channel of ['beta', 'nightly']) {
    assert.equal(updateChannel(channel), channel)
    assert.deepEqual(updateRelease(manifest(), channel), manifest())
  }
  for (const input of [
    'nightly-green',
    'stable',
    'https://evil.invalid',
    null,
    {},
    1,
  ])
    assert.throws(() => updateChannel(input))
  for (const input of [0, 2, '6', null])
    assert.throws(() => updateCheckFrequency(input))
  assert.equal(updateCheckFrequency(24), 24)
  const nightly = manifest(nightlyVersion, nightlyTag)
  assert.deepEqual(updateRelease(nightly, 'nightly'), nightly)
  assert.throws(() => updateRelease(nightly, 'beta'))
  for (const patch of [
    { tag: '../../evil' },
    { tag: null, version: 'invalid' },
    { version: [nightlyVersion], tag: nightlyTag },
    { tag: 'v0.2.1' },
    { version: '../package' },
    { version: '00.2.0', tag: 'v00.2.0' },
    { version: '0.2.0-beta.1', tag: 'v0.2.0-beta.1' },
    { version: '0.2.0+meta', tag: 'v0.2.0+meta' },
    { assets: [] },
    { assets: null },
  ])
    assert.throws(() => updateRelease({ ...manifest(), ...patch }, 'nightly'))
  for (const patch of [
    { tag: nightlyTag.replace('nightly-', 'nightly-broken-') },
    { tag: nightlyTag.replace('aaaaaaa', 'bbbbbbb') },
    { tag: nightlyTag.replace('-15-1', '-15-2') },
    { tag: nightlyTag.replace('09-21', '09-22') },
    { version: nightlyVersion.replace('.15.1', '.015.1') },
    { version: nightlyVersion.replace('.gaaaaaaa', '.aaaaaaa') },
    { version: nightlyVersion.replace('.15.1', '') },
  ])
    assert.throws(() => updateRelease({ ...nightly, ...patch }, 'nightly'))
  for (const asset of [
    { name: '../evil.dmg' },
    { name: 'hibi-0.1.0-mac-x64.dmg' },
    { sha512: 'missing' },
    { size: -1 },
    { size: 0 },
    { size: 1.5 },
    { zip: { ...manifest().assets['darwin-x64'].zip, name: '../evil.zip' } },
  ])
    assert.throws(() =>
      updateRelease(
        {
          ...manifest(),
          assets: {
            'darwin-x64': { ...manifest().assets['darwin-x64'], ...asset },
          },
        },
        'beta',
      ),
    )
})

test('update ordering uses semver core and release precedence, then nightly date/run/attempt', () => {
  for (const [next, current] of [
    ['0.2.0', '0.2.0-nightly.20260921.gaaaaaaa.15.1'],
    [nightlyVersion, '0.2.0'],
    [nightlyVersion, '0.2.1-nightly.20260921.gfffffff.14.9'],
    [nightlyVersion, '0.2.1-nightly.20260920.gfffffff.99.9'],
    [nightlyVersion, '0.2.1-nightly.20260921.gfffffff.15.0'],
    [nightlyVersion, '0.2.1-nightly.20260921.fffffff'],
    ['0.10.0', '0.9.99'],
    ['1.0.0', '0.99.99'],
    [
      '0.2.1-nightly.20260921.gaaaaaaa.100.1',
      '0.2.1-nightly.20260921.gfffffff.99.9',
    ],
  ]) {
    assert.ok(newerUpdate(next, current), `${next} > ${current}`)
    assert.ok(!newerUpdate(current, next), `${current} < ${next}`)
  }
  assert.ok(
    !newerUpdate(nightlyVersion, nightlyVersion.replace('aaaaaaa', 'bbbbbbb')),
  )
  for (const input of [version, nightlyVersion, 'invalid', '00.2.0'])
    assert.ok(!newerUpdate(input, input))
  assert.ok(!newerUpdate(version, 'invalid'))
  assert.ok(!newerUpdate('invalid', version))
})

async function adapter(
  t,
  platform = 'darwin',
  arch = 'x64',
  packaged = true,
  appImage = '/tmp/hibi.AppImage',
) {
  const root = await mkdtemp(join(tmpdir(), 'hibi-updater-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'updates.mjs')
  await build({
    stdin: {
      contents: `export * from './src/main/updates.ts'; export { state as mock } from 'electron';`,
      resolveDir: resolve('.'),
    },
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      'process.platform': JSON.stringify(platform),
      'process.arch': JSON.stringify(arch),
      'process.env.APPIMAGE': appImage ? JSON.stringify(appImage) : 'undefined',
    },
    plugins: [
      {
        name: 'update-host',
        setup(build) {
          build.onResolve(
            { filter: /^(electron|electron-updater)$/ },
            ({ path }) => ({ path, namespace: 'mock' }),
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? `
        export const state = { requests: [], events: [], quit: 0, packaged: ${packaged}, version: '0.1.0', response: undefined, installs: 0, downloads: 0, listeners: {}, failInstall: false };
        export const app = { get isPackaged() { return state.packaged }, getPath: () => ${JSON.stringify(root)}, getVersion: () => state.version, quit: () => { state.quit++ } };
        export const BrowserWindow = { getAllWindows: () => [{ webContents: { send: (...args) => state.events.push(args) } }] };
        export const net = { fetch: async (url) => { state.requests.push(url); if (state.wait) await state.wait; if (state.error) throw new Error('offline'); return new Response(JSON.stringify(state.response), { status: state.http ?? 200 }); } };
      `
                : `
        import { state } from 'electron';
        const autoUpdater = { on: (event, callback) => { state.listeners[event] = callback }, setFeedURL: (feed) => { state.feed = feed },
          checkForUpdates: async () => {
            const assets = state.response.assets;
            const selected = ${platform === 'darwin' ? "[assets['darwin-arm64'].zip, assets['darwin-x64'].zip]" : `[assets[${JSON.stringify(`${platform}-${arch}`)}]]`};
            const files = selected.map((asset) => ({ url: asset.name, sha512: asset.sha512, size: asset.size }));
            if (state.badMetadata) files[0].sha512 = 'wrong';
            return { isUpdateAvailable: true, updateInfo: { version: state.response.version, files } };
          },
          downloadUpdate: async () => { state.downloads++; state.listeners['download-progress']({ percent: 50 }); if(state.failDownload) throw new Error('download failed'); return ['/tmp/update']; },
          quitAndInstall: () => { if (state.failInstall) state.listeners.error(new Error('install failed')); else state.installs++ }
        }; state.client = autoUpdater; export default { autoUpdater };
      `,
          }))
        },
      },
    ],
  })
  const manager = await import(pathToFileURL(output).href)
  manager.mock.response = manifest()
  await manager.loadUpdates()
  return { ...manager, root }
}

test('channel preferences migrate once on read and invalid or missing choices default to beta', async (t) => {
  const manager = await adapter(t)
  const path = join(manager.root, 'update-channel.json')
  assert.equal(JSON.parse(await readFile(path, 'utf8')), 'beta')
  for (const [saved, expected] of [
    ['nightly-green', 'beta'],
    ['nightly', 'nightly'],
    ['beta', 'beta'],
    ['stable', 'beta'],
    [null, 'beta'],
    [{ channel: 'nightly' }, 'beta'],
  ]) {
    await writeFile(path, JSON.stringify(saved))
    await manager.loadUpdates()
    assert.equal(manager.getUpdateState().channel, expected)
    assert.equal(JSON.parse(await readFile(path, 'utf8')), expected)
    // A valid stored choice is read without rewriting it.
    await writeFile(path, `${JSON.stringify(expected)}\n`)
    await manager.loadUpdates()
    assert.equal(await readFile(path, 'utf8'), `${JSON.stringify(expected)}\n`)
  }
  await writeFile(path, 'not json')
  await manager.loadUpdates()
  assert.equal(manager.getUpdateState().channel, 'beta')
  assert.equal(JSON.parse(await readFile(path, 'utf8')), 'beta')
})

test('mac pins both signed ZIPs, installs after close confirmation, and persists channel choice', async (t) => {
  const manager = await adapter(t, 'darwin', 'arm64')
  const { mock } = manager
  assert.equal(manager.getUpdateState().channel, 'beta')
  assert.equal((await manager.checkForUpdates()).status, 'available')
  assert.equal(
    manager.getUpdateState().message,
    `An update is available: ${version}`,
  )
  assert.match(mock.requests[0], /beta\/feed.json$/)
  mock.badMetadata = true
  assert.equal((await manager.downloadUpdate()).status, 'error')
  assert.match(manager.getUpdateState().message, /metadata changed/)
  assert.equal(mock.downloads, 0)
  await assert.rejects(manager.installUpdate(), /Download an update/)
  mock.badMetadata = false
  assert.equal((await manager.downloadUpdate()).status, 'downloaded')
  assert.equal(
    manager.getUpdateState().message,
    `An update is available: ${version}`,
  )
  assert.match(mock.feed.url, new RegExp(`${tag}/$`))
  assert.equal(mock.downloads, 1)
  await manager.setUpdateChannel('nightly')
  assert.equal(manager.getUpdateState().version, undefined)
  await assert.rejects(manager.installUpdate())
  assert.equal(
    JSON.parse(
      await readFile(join(manager.root, 'update-channel.json'), 'utf8'),
    ),
    'nightly',
  )
  await manager.loadUpdates()
  assert.equal(manager.getUpdateState().channel, 'nightly')
  mock.response = manifest(nightlyVersion, nightlyTag)
  assert.equal((await manager.checkForUpdates()).status, 'available')
  assert.match(mock.requests.at(-1), /\/nightly\/feed.json$/)
  await manager.setUpdateChannel('beta')
  assert.equal((await manager.checkForUpdates()).status, 'error')

  const install = await adapter(t, 'darwin', 'x64')
  let failedInstall = 0
  install.onUpdateInstallFailure(() => failedInstall++)
  await install.checkForUpdates()
  assert.equal((await install.downloadUpdate()).status, 'downloaded')
  await install.installUpdate()
  assert.equal(install.mock.quit, 1)
  install.cancelUpdateInstall()
  assert.equal(install.finishUpdateInstall(), undefined)
  await install.installUpdate()
  assert.equal(install.finishUpdateInstall(), true)
  assert.equal(install.mock.installs, 1)
  install.mock.listeners.error(new Error('late install failure'))
  assert.equal(failedInstall, 1)
  assert.equal(install.getUpdateState().status, 'error')
  assert.equal((await install.downloadUpdate()).status, 'downloaded')
})

test('checks handle missing feeds, offline failures, concurrent actions, and installed versions without downgrading', async (t) => {
  const manager = await adapter(t)
  manager.mock.http = 404
  assert.match(
    (await manager.checkForUpdates()).message,
    /No build is available/,
  )
  manager.mock.http = 200
  manager.mock.error = true
  assert.equal((await manager.checkForUpdates()).status, 'error')
  manager.mock.error = false
  let resume
  manager.mock.wait = new Promise((resolve) => {
    resume = resolve
  })
  const checking = manager.checkForUpdates()
  await assert.rejects(manager.setUpdateChannel('nightly'), /Wait for/)
  await assert.rejects(manager.checkForUpdates(), /Wait for/)
  resume()
  await checking
  manager.mock.version = '0.3.0'
  assert.equal((await manager.checkForUpdates()).status, 'idle')
  assert.equal(manager.getUpdateState().version, undefined)
  const development = await adapter(t, 'darwin', 'x64', false)
  development.startUpdateChecks()
  assert.equal((await development.checkForUpdates()).status, 'error')
  assert.equal(development.mock.requests.length, 0)
  // Debian and Flatpak installs have no AppImage path to replace.
  const systemPackage = await adapter(t, 'linux', 'arm64', true, '')
  assert.equal(systemPackage.getUpdateState().supported, false)
  assert.equal((await systemPackage.checkForUpdates()).status, 'error')
  assert.equal(systemPackage.mock.requests.length, 0)
})

test('startup and frequency choices persist and reschedule checks', async (t) => {
  const manager = await adapter(t, 'win32')
  assert.equal(manager.getUpdateState().checkOnStartup, true)
  assert.equal(manager.getUpdateState().checkFrequency, 6)
  assert.throws(() => manager.setUpdateStartupCheck('false'), /startup/)
  assert.throws(() => manager.setUpdateCheckFrequency('12'), /frequency/)
  await manager.setUpdateStartupCheck(false)
  assert.equal(manager.getUpdateState().checkOnStartup, false)
  assert.equal(
    JSON.parse(
      await readFile(join(manager.root, 'update-startup-check.json'), 'utf8'),
    ),
    false,
  )
  await manager.loadUpdates()
  assert.equal(manager.getUpdateState().checkOnStartup, false)

  const scheduled = []
  const cleared = []
  const originalTimeout = globalThis.setTimeout
  const originalInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  try {
    globalThis.setTimeout = (callback, delay) => {
      scheduled.push({ callback, delay })
      return { unref() {} }
    }
    globalThis.setInterval = (callback, delay) => {
      const timer = { unref() {} }
      scheduled.push({ callback, delay, timer })
      return timer
    }
    globalThis.clearInterval = (timer) => cleared.push(timer)
    manager.startUpdateChecks()
    await manager.setUpdateCheckFrequency(12)
  } finally {
    globalThis.setTimeout = originalTimeout
    globalThis.setInterval = originalInterval
    globalThis.clearInterval = originalClearInterval
  }
  assert.deepEqual(
    scheduled.map(({ delay }) => delay),
    [15_000, 6 * 60 * 60 * 1000, 12 * 60 * 60 * 1000],
  )
  assert.deepEqual(cleared, [scheduled[1].timer])
  assert.equal(manager.getUpdateState().checkFrequency, 12)
  assert.equal(
    JSON.parse(
      await readFile(join(manager.root, 'update-check-frequency.json'), 'utf8'),
    ),
    12,
  )
  await manager.loadUpdates()
  assert.equal(manager.getUpdateState().checkFrequency, 12)
  manager.mock.version = version
  scheduled[0].callback()
  assert.equal(manager.mock.requests.length, 0)
  scheduled[2].callback()
  await new Promise(setImmediate)
  assert.equal(manager.mock.requests.length, 1)
  assert.equal(manager.getUpdateState().status, 'idle')

  await manager.setUpdateStartupCheck(true)
  scheduled[0].callback()
  await new Promise(setImmediate)
  assert.equal(manager.mock.requests.length, 2)
  assert.equal(manager.getUpdateState().checkOnStartup, true)
})

test('windows and linux pin downloads and install only after close confirmation; cancellation and errors keep protection', async (t) => {
  for (const [platform, arch] of [
    ['win32', 'x64'],
    ['linux', 'x64'],
    ['linux', 'arm64'],
  ]) {
    const manager = await adapter(t, platform, arch)
    await manager.checkForUpdates()
    manager.mock.failDownload = true
    assert.equal((await manager.downloadUpdate()).status, 'error')
    manager.mock.failDownload = false
    assert.equal((await manager.downloadUpdate()).status, 'downloaded')
    assert.match(manager.mock.feed.url, new RegExp(`${tag}/$`))
    assert.equal(manager.mock.client.autoInstallOnAppQuit, false)
    assert.equal(manager.mock.installs, 0)
    await manager.installUpdate()
    assert.equal(manager.mock.quit, 1)
    assert.equal(manager.mock.installs, 0)
    manager.cancelUpdateInstall()
    assert.equal(manager.finishUpdateInstall(), undefined)
    assert.equal(manager.mock.installs, 0)
    await manager.installUpdate()
    manager.mock.failInstall = true
    assert.equal(manager.finishUpdateInstall(), false)
    assert.equal(manager.getUpdateState().status, 'error')
    manager.mock.failInstall = false
    await manager.downloadUpdate()
    await manager.installUpdate()
    assert.equal(manager.finishUpdateInstall(), true)
    assert.equal(manager.mock.installs, 1)
  }
})

test('update settings expose both channels, persist choice, and fit narrow windows', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-update-ui-'))
  let app
  t.after(async () => {
    await app?.close()
    await rm(profile, { recursive: true, force: true })
  })
  for (const expected of ['beta', 'nightly']) {
    app = await electron.launch({
      args: [resolve('.'), `--user-data-dir=${profile}`],
    })
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await clickMenu(app, 'Settings')
    await page.getByRole('tab', { name: 'About', exact: true }).click()
    const picker = page.getByLabel('Update channel', { exact: true })
    await picker.waitFor()
    await page.waitForFunction(
      () => !document.querySelector('#update-channel').disabled,
    )
    assert.equal(await picker.inputValue(), expected)
    const frequency = page.getByLabel('Check frequency', { exact: true })
    assert.equal(
      await frequency.inputValue(),
      expected === 'nightly' ? '12' : '6',
    )
    const startup = page.getByRole('checkbox', {
      name: 'Check for updates on startup',
    })
    assert.equal(await startup.isChecked(), expected === 'beta')
    if (expected === 'nightly') {
      assert.deepEqual(errors, [])
      await app.close()
      app = undefined
      continue
    }
    assert.deepEqual(await picker.locator('option').allTextContents(), [
      'Beta (stable)',
      'Nightly (bleeding edge)',
    ])
    await assert.rejects(
      page.evaluate(() => window.hibi.setUpdateChannel('https://evil.invalid')),
      /valid update channel/,
    )
    await assert.rejects(
      page.evaluate(() => window.hibi.setUpdateStartupCheck('false')),
      /startup/,
    )
    await assert.rejects(
      page.evaluate(() => window.hibi.setUpdateCheckFrequency(2)),
      /frequency/,
    )
    await frequency.selectOption('12')
    await waitForAsync(
      page,
      async () => (await window.hibi.getUpdateState()).checkFrequency === 12,
      undefined,
      { timeout: 30000 },
    )
    await startup.uncheck()
    await waitForAsync(
      page,
      async () => !(await window.hibi.getUpdateState()).checkOnStartup,
      undefined,
      { timeout: 30000 },
    )
    await page.waitForFunction(
      () => !document.querySelector('#update-startup-check').checked,
    )
    assert.equal(await startup.isChecked(), false)
    await picker.selectOption('nightly')
    await waitForAsync(
      page,
      async () => (await window.hibi.getUpdateState()).channel === 'nightly',
      undefined,
      { timeout: 30000 },
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Check for updates', exact: true })
        .isDisabled(),
      true,
    )
    const showUpdate = (status, progress) =>
      app.evaluate(
        ({ BrowserWindow }, update) => {
          BrowserWindow.getAllWindows()[0].webContents.send(
            'updates:changed',
            update,
          )
        },
        {
          channel: 'nightly',
          status,
          supported: true,
          checkOnStartup: false,
          version,
          progress,
          message: `An update is available: ${version}`,
        },
      )
    await showUpdate('available', 0)
    await page
      .locator('#install-update-description')
      .getByText(`An update is available: ${version}`, { exact: true })
      .waitFor()
    await showUpdate('downloading', 50)
    const download = page.getByRole('button', {
      name: 'Downloading 50%',
      exact: true,
    })
    await download.waitFor()
    assert.equal(await download.isDisabled(), true)
    assert.equal(
      await download.evaluate((element) =>
        getComputedStyle(element).backgroundImage.includes('50%'),
      ),
      true,
    )
    assert.equal(
      await page.locator('#install-update-description').textContent(),
      `An update is available: ${version}`,
    )
    assert.equal(await picker.isDisabled(), true)
    assert.equal(await startup.isDisabled(), true)
    for (const width of [480, 1000]) {
      await page.setViewportSize({ width, height: 760 })
      await mkdir('test-results', { recursive: true })
      await page.screenshot({
        path: `test-results/update-downloading-${width}.png`,
        animations: 'disabled',
      })
    }
    await showUpdate('downloading', 75)
    await page
      .getByRole('button', { name: 'Downloading 75%', exact: true })
      .waitFor()
    await showUpdate('downloaded', 100)
    await page
      .getByRole('button', { name: 'Restart and install', exact: true })
      .waitFor()
    await showUpdate('available', 0)
    await page
      .getByRole('button', { name: 'Download update', exact: true })
      .waitFor()
    await page
      .getByText(
        'Nightly builds are bleeding edge. Back up your notes before installing.',
      )
      .waitFor()
    assert.equal(
      await page.getByText('failed required checks', { exact: false }).count(),
      0,
    )
    for (const width of [480, 1000]) {
      await page.setViewportSize({ width, height: 760 })
      await picker.scrollIntoViewIfNeeded()
      const panel = page.getByRole('tabpanel', { name: 'About', exact: true })
      assert.equal(
        await panel.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
        true,
      )
      await mkdir('test-results', { recursive: true })
      await page.screenshot({
        path: `test-results/update-settings-${width}.png`,
        animations: 'disabled',
      })
    }
    assert.deepEqual(errors, [])
    await app.close()
    app = undefined
  }
})
