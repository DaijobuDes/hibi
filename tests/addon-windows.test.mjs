import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { electron } from './electron.mjs'

const windowUrl = 'app://hibi/addon-window.html'

const appWindows = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((window) => window.webContents.getURL())
      .filter((url) => !url.startsWith('hibi-analysis:')),
  )

async function until(check) {
  const deadline = performance.now() + 10000
  for (;;) {
    const value = await check()
    if (value) return value
    if (performance.now() > deadline)
      throw new Error(`Condition did not settle: ${check}`)
    await setTimeout(30)
  }
}

async function addonPage(app, id) {
  for (const page of app.windows())
    if (
      page.url() === windowUrl &&
      (await page.evaluate(() => window.hibiAddonWindow.context())).id === id
    )
      return page
  return null
}

test('addon windows open once per id and close with their addon', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-addon-windows-'))
  const profile = join(root, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ 'quick-note': true }),
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  // Count every call that could raise or focus the main window.
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'app://hibi/',
    )
    globalThis.mainWindowRaised = 0
    for (const name of ['show', 'focus', 'restore', 'moveTop']) {
      const original = main[name].bind(main)
      main[name] = (...args) => {
        globalThis.mainWindowRaised++
        return original(...args)
      }
    }
  })
  const open = (id, options = {}) =>
    page.evaluate(
      ({ id, options }) =>
        window.hibi.openAddonWindow('quick-note', { id, ...options }),
      { id, options },
    )

  await open('one', {
    title: 'First',
    position: 'cursor-display',
    panel: true,
    titleBar: 'hibi',
  })
  await open('one')
  await open('two', { input: { note: 'second' } })
  assert.deepEqual((await appWindows(app)).sort(), [
    'app://hibi/',
    windowUrl,
    windowUrl,
  ])
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((window) => window.webContents.getURL().endsWith('window.html'))
        .map((window) => window.getTitle())
        .sort(),
    ),
    ['First', 'Quick note'],
  )
  assert.equal(await app.evaluate(() => globalThis.mainWindowRaised), 0)

  const second = await until(() => addonPage(app, 'two'))
  assert.deepEqual(
    await second.evaluate(async () => ({
      hibi: typeof window.hibi,
      context: await window.hibiAddonWindow.context(),
    })),
    {
      hibi: 'undefined',
      context: {
        addonId: 'quick-note',
        id: 'two',
        input: { note: 'second' },
        title: 'Quick note',
        titleBar: 'native',
        platform: process.platform,
      },
    },
  )
  // Native requests always go to the window's own addon.
  assert.ok(
    Array.isArray(
      await second.evaluate(() => window.hibiAddonWindow.query('targets')),
    ),
  )
  assert.equal(await second.locator('.addon-window-titlebar').count(), 0)
  const first = await until(() => addonPage(app, 'one'))
  assert.equal(
    await first.locator('.addon-window-titlebar').innerText(),
    'First',
  )
  await second
    .getByRole('alert')
    .getByText('This addon window is unavailable.')
    .waitFor()

  await page.evaluate(() => {
    window.closedAddonWindows = []
    window.hibi.onAddonWindowClosed((addonId, id) =>
      window.closedAddonWindows.push(`${addonId}/${id}`),
    )
  })
  await page.evaluate(() => window.hibi.closeAddonWindow('quick-note', 'two'))
  await page.waitForFunction(() =>
    window.closedAddonWindows.includes('quick-note/two'),
  )

  await assert.rejects(
    page.evaluate(() => window.hibi.openAddonWindow('keybeats', { id: 'x' })),
    /Enable this addon/,
  )
  await assert.rejects(open('Bad id'), /invalid window options/)
  await assert.rejects(
    open('big', { input: 'x'.repeat(70000) }),
    /JSON under 64 KB/,
  )

  // Size and position are remembered for the display the window was on.
  const moved = await app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea
    const bounds = { x: area.x + 40, y: area.y + 40, width: 480, height: 400 }
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().endsWith('window.html'))
      .setBounds(bounds)
    return bounds
  })
  await page.evaluate(() => window.hibi.closeAddonWindow('quick-note', 'one'))
  await until(async () => {
    const saved = await readFile(join(profile, 'addon-windows.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}))
    return Object.values(saved['quick-note/one'] ?? {}).some(
      (bounds) => bounds.width === moved.width,
    )
  })
  await open('one', { panel: true })
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('window.html'))
        .getBounds(),
    ),
    moved,
  )

  await page.evaluate(() => window.hibi.setAddonEnabled('quick-note', false))
  await until(async () => (await appWindows(app)).length === 1)
})
