import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parse } from 'yaml'
import { platforms } from '../scripts/nightly.mjs'
import { updateFeed } from '../scripts/update-feed.mjs'
import {
  newerUpdate,
  updateChannel,
  updateRelease,
} from '../src/shared/updates.ts'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

const version = '0.1.0-nightly.20260921.gaaaaaaa.15.1'
const tag = 'nightly-2026-09-21-aaaaaaa-15-1'
const bytes = Buffer.from('a verified installer')
const sha512 = createHash('sha512').update(bytes).digest('base64')
const manifest = (broken = false) => ({
  tag: broken ? tag.replace('nightly-', 'nightly-broken-') : tag,
  version,
  status: broken ? 'nightly-broken' : 'nightly-green',
  assets: Object.fromEntries(
    [
      ['win32-x64', 'win-x64.exe'],
      ['linux-x64', 'linux-x64.AppImage'],
      ['darwin-arm64', 'mac-arm64.dmg'],
      ['darwin-x64', 'mac-x64.dmg'],
    ].map(([platform, suffix]) => [
      platform,
      { name: `hibi-${version}-${suffix}`, sha512, size: bytes.length },
    ]),
  ),
})

test('channels fail closed and nightly ordering uses numeric runs rather than commit hashes', () => {
  assert.equal(updateChannel('nightly'), 'nightly')
  for (const input of ['stable', 'https://evil.invalid', null, {}, 1])
    assert.throws(() => updateChannel(input))
  assert.equal(updateRelease(manifest(), 'nightly-green').version, version)
  assert.equal(
    updateRelease(manifest(true), 'nightly').status,
    'nightly-broken',
  )
  assert.throws(() => updateRelease(manifest(true), 'nightly-green'))
  for (const patch of [
    { tag: '../../evil' },
    { version: '../package' },
    { status: 'stable' },
    {
      assets: {
        'darwin-x64': {
          ...manifest().assets['darwin-x64'],
          name: '../evil.dmg',
        },
      },
    },
    {
      assets: {
        'darwin-x64': { ...manifest().assets['darwin-x64'], sha512: 'missing' },
      },
    },
    {
      assets: {
        'darwin-x64': { ...manifest().assets['darwin-x64'], size: -1 },
      },
    },
  ])
    assert.throws(() => updateRelease({ ...manifest(), ...patch }, 'nightly'))
  assert.ok(newerUpdate(version, '0.1.0-nightly.20260921.gfffffff.14.9'))
  assert.ok(newerUpdate(version, '0.1.0-nightly.20260920.gfffffff.99.9'))
  assert.ok(newerUpdate(version, '0.1.0-nightly.20260921.fffffff'))
  assert.ok(newerUpdate(version, '0.1.0'))
  assert.ok(!newerUpdate(version, version))
  assert.ok(!newerUpdate(version, '0.1.0-nightly.20260921.g0000000.16.1'))
  assert.ok(!newerUpdate(version, '0.2.0'))
  assert.ok(!newerUpdate(version, 'invalid'))
})

test('publication hashes real installers and keeps both feeds pinned to a complete classified release', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-feed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const asset of Object.values(manifest().assets))
    await writeFile(join(root, asset.name), bytes)
  const reports = platforms.map((platform) => ({
    platform,
    sha: 'a'.repeat(40),
    build: 'success',
    package: 'success',
    checks: 'success',
  }))
  for (const broken of [false, true]) {
    const release = {
      ...manifest(broken),
      channel: 'nightly',
      sha: 'a'.repeat(40),
      reports: reports.map((report, i) => ({
        ...report,
        checks: broken && !i ? 'failure' : 'success',
      })),
    }
    assert.deepEqual(await updateFeed(release, root), manifest(broken))
    for (const [platform, name] of [
      ['win32-x64', 'latest.yml'],
      ['linux-x64', 'latest-linux.yml'],
    ]) {
      const feed = parse(await readFile(join(root, name), 'utf8'))
      assert.equal(feed.version, version)
      assert.deepEqual(feed.files, [
        { url: manifest().assets[platform].name, sha512, size: bytes.length },
      ])
    }
  }
  await assert.rejects(
    updateFeed(
      {
        ...manifest(),
        channel: 'nightly',
        sha: 'a'.repeat(40),
        reports: reports.slice(1),
      },
      root,
    ),
    /Every release platform/,
  )
  const workflow = parse(
    await readFile('.github/workflows/nightly.yml', 'utf8'),
  )
  const steps = workflow.jobs.publish.steps
  assert.ok(
    steps.findIndex((step) => step.name === 'Generate verified update feeds') <
      steps.findIndex((step) => step.id === 'publish'),
  )
  const green = steps.find(
    (step) => step.name === 'Update recommended nightly pointer',
  )
  assert.equal(green.if, "steps.classify.outputs.status == 'nightly-green'")
  assert.match(
    green.run,
    /gh release upload nightly-green installers\/update.json/,
  )
  const all = steps.find((step) => step.name === 'Update all-nightlies feed')
  assert.equal(all.if, "needs.prepare.outputs.channel == 'nightly'")
  assert.ok(
    steps.indexOf(all) <
      steps.findIndex((step) => step.name === 'Surface broken nightly checks'),
  )
})

async function adapter(t, platform = 'darwin', arch = 'x64', packaged = true) {
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
      'process.env.APPIMAGE': JSON.stringify('/tmp/hibi.AppImage'),
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
        export const state = { requests: [], events: [], quit: 0, opened: [], packaged: ${packaged}, version: '0.1.0', response: undefined, bytes: Buffer.from('a verified installer'), installs: 0, downloads: 0, listeners: {}, failInstall: false };
        export const app = { get isPackaged() { return state.packaged }, getPath: () => ${JSON.stringify(root)}, getVersion: () => state.version, quit: () => { state.quit++ } };
        export const BrowserWindow = { getAllWindows: () => [{ webContents: { send: (...args) => state.events.push(args) } }] };
        export const net = { fetch: async (url) => { state.requests.push(url); if (state.wait) await state.wait; if (state.error) throw new Error('offline'); return url.endsWith('update.json') ? new Response(JSON.stringify(state.response), { status: state.http ?? 200 }) : new Response(state.bytes); } };
        export const shell = { openPath: async (path) => { state.opened.push(path); return '' } };
      `
                : `
        import { state } from 'electron';
        const autoUpdater = { on: (event, callback) => { state.listeners[event] = callback }, setFeedURL: (feed) => { state.feed = feed },
          checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: state.response.version, files: [ { ...state.response.assets[${JSON.stringify(`${platform}-${arch}`)}], url: state.response.assets[${JSON.stringify(`${platform}-${arch}`)}].name } ] } }),
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

test('mac downloads verified architecture-specific installers, rejects corruption, and persists channel choice', async (t) => {
  const manager = await adapter(t, 'darwin', 'arm64')
  const { mock } = manager
  assert.equal(manager.getUpdateState().channel, 'nightly-green')
  assert.equal((await manager.checkForUpdates()).status, 'available')
  assert.match(mock.requests[0], /nightly-green\/update.json$/)
  mock.bytes = Buffer.from('x'.repeat(bytes.length))
  assert.equal((await manager.downloadUpdate()).status, 'error')
  assert.match(manager.getUpdateState().message, /could not be verified/)
  assert.ok(
    !(await readdir(manager.root)).some((name) =>
      name.startsWith('hibi-update-'),
    ),
  )
  await assert.rejects(manager.installUpdate(), /Download an update/)
  mock.bytes = bytes
  assert.equal((await manager.downloadUpdate()).status, 'downloaded')
  assert.match(mock.requests.at(-1), /mac-arm64.dmg$/)
  await manager.installUpdate()
  assert.equal(await readFile(mock.opened[0], 'utf8'), bytes.toString())
  assert.equal(mock.quit, 0)
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
  mock.response = manifest(true)
  assert.equal((await manager.checkForUpdates()).broken, true)
  assert.match(mock.requests.at(-1), /\/nightly\/update.json$/)
  await manager.setUpdateChannel('nightly-green')
  assert.equal((await manager.checkForUpdates()).status, 'error')
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
  manager.mock.version = '0.2.0'
  assert.equal((await manager.checkForUpdates()).status, 'idle')
  assert.equal(manager.getUpdateState().version, undefined)
  const development = await adapter(t, 'darwin', 'x64', false)
  development.startUpdateChecks()
  assert.equal((await development.checkForUpdates()).status, 'error')
  assert.equal(development.mock.requests.length, 0)
})

test('windows and linux pin downloads and install only after close confirmation; cancellation and errors keep protection', async (t) => {
  for (const platform of ['win32', 'linux']) {
    const manager = await adapter(t, platform)
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
  for (const expected of ['nightly-green', 'nightly']) {
    app = await electron.launch({
      args: [resolve('.'), `--user-data-dir=${profile}`],
    })
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await clickMenu(app, 'Settings')
    const picker = page.getByLabel('Update channel', { exact: true })
    await picker.waitFor()
    await page.waitForFunction(
      () => !document.querySelector('#update-channel').disabled,
    )
    assert.equal(await picker.inputValue(), expected)
    assert.deepEqual(await picker.locator('option').allTextContents(), [
      'Recommended nightly',
      'Nightly',
    ])
    await assert.rejects(
      page.evaluate(() => window.hibi.setUpdateChannel('https://evil.invalid')),
      /valid update channel/,
    )
    await picker.selectOption('nightly')
    await page.waitForFunction(
      async () => (await window.hibi.getUpdateState()).channel === 'nightly',
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
          manualInstall: true,
          version,
          broken: true,
          progress,
          message:
            'An update is available. Save and back up your documents before installing.',
        },
      )
    await showUpdate('downloading', 50)
    await page.getByRole('status').filter({ hasText: '50%' }).waitFor()
    assert.equal(await picker.isDisabled(), true)
    await showUpdate('downloaded', 100)
    await page
      .getByRole('button', { name: 'Open installer', exact: true })
      .waitFor()
    await showUpdate('available', 0)
    await page
      .getByRole('button', { name: 'Download update', exact: true })
      .waitFor()
    await page
      .getByRole('status')
      .filter({ hasText: 'failed required checks' })
      .waitFor()
    for (const width of [480, 1000]) {
      await page.setViewportSize({ width, height: 760 })
      await picker.scrollIntoViewIfNeeded()
      const panel = page.getByRole('tabpanel', { name: 'Hibi', exact: true })
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
    await mkdir('test-results', { recursive: true })
    await page.screenshot({
      path: 'test-results/update-settings.png',
      animations: 'disabled',
    })
    assert.deepEqual(errors, [])
    await app.close()
    app = undefined
  }
})
