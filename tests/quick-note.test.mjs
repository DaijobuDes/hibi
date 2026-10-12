import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

const captureUrl = /\/addon-window\.html$/

async function captureWindow(app) {
  const deadline = performance.now() + 10000
  for (;;) {
    const page = app.windows().find((item) => captureUrl.test(item.url()))
    if (page) {
      await page.getByRole('textbox', { name: 'Note' }).waitFor()
      return page
    }
    if (performance.now() > deadline)
      throw new Error('The quick note window did not open.')
    await setTimeout(30)
  }
}

async function openCapture(app, page) {
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note: capture')
  await page.getByRole('option', { name: /Quick note: capture/i }).click()
  return captureWindow(app)
}

async function saveCapture(capture, name) {
  const closed = capture.waitForEvent('close')
  await capture.getByRole('button', { name: 'Save', exact: true }).click()
  await capture.getByRole('status').getByText(`Saved ${name}.`).waitFor()
  await closed
}

const appWindows = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((window) => window.webContents.getURL())
      .filter((url) => !url.startsWith('hibi-analysis:')),
  )

// Count every call that could raise or focus the main window.
const watchMainWindow = (app) =>
  app.evaluate(({ BrowserWindow }) => {
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
const mainWindowRaised = (app) =>
  app.evaluate(() => globalThis.mainWindowRaised)

test('quick note captures to a chosen folder without replacing files', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-quick-note-'))
  const workspace = join(root, 'workspace')
  const folder = join(workspace, 'Notes')
  const profile = join(root, 'profile')
  await mkdir(folder, { recursive: true })
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
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, workspace)
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  await page.evaluate(() => window.hibi.openWorkspace())
  await watchMainWindow(app)
  const defaultCapture = await openCapture(app, page)
  const urls = await appWindows(app)
  assert.equal(urls.length, 2)
  assert.equal(urls.filter((url) => captureUrl.test(url)).length, 1)
  assert.equal(
    await defaultCapture.getByRole('textbox', { name: 'Title' }).count(),
    0,
  )
  await defaultCapture
    .getByRole('textbox', { name: 'Note' })
    .fill('Default thought')
  await saveCapture(defaultCapture, 'Quick note.md')
  assert.equal(
    await readFile(join(workspace, 'Quick note.md'), 'utf8'),
    'Default thought',
  )
  assert.equal(await mainWindowRaised(app), 0)
  assert.deepEqual(await appWindows(app), ['app://hibi/'])
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note settings')
  await page.getByRole('option', { name: /Quick note settings/i }).click()
  await page.getByLabel('Folder', { exact: true }).selectOption('Notes')
  await page.getByLabel('Ask for a title').check()
  await page.getByLabel('Default title').fill('Draft')
  await page.getByLabel('Global shortcut').fill('')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await page
    .getByRole('status')
    .getByText('Quick note settings saved.')
    .waitFor()
  const dialog = await openCapture(app, page)
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Daily')
  await dialog.getByRole('textbox', { name: 'Note' }).fill('First thought')
  await saveCapture(dialog, 'Daily.md')
  assert.equal(
    await readFile(join(folder, 'Daily.md'), 'utf8'),
    'First thought',
  )

  const request = {
    workspaceId: '',
    folder: 'Notes',
    title: 'Daily',
    markdown: 'Second thought',
  }
  const second = await page.evaluate(
    (input) => window.hibi.invokeAddon('quick-note', 'save', input),
    request,
  )
  assert.equal(second.name, 'Daily 2.md')
  assert.equal(
    await readFile(join(folder, 'Daily.md'), 'utf8'),
    'First thought',
  )
  assert.equal(
    await readFile(join(folder, 'Daily 2.md'), 'utf8'),
    'Second thought',
  )
  await assert.rejects(
    page.evaluate(
      (input) =>
        window.hibi.invokeAddon('quick-note', 'save', {
          ...input,
          folder: '../outside',
        }),
      request,
    ),
    /file or folder name|folder inside/,
  )

  const other = join(root, 'other')
  await mkdir(join(other, 'Inbox'), { recursive: true })
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, other)
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note settings')
  await page.getByRole('option', { name: /Quick note settings/i }).click()
  const settings = page.getByRole('tabpanel', { name: 'Quick note' })
  await settings.getByRole('button', { name: 'Choose workspace…' }).click()
  const recent = await page.evaluate(() => window.hibi.getRecentWorkspaces())
  const otherPath = await realpath(other)
  const otherId = recent.find((entry) => entry.path === otherPath)?.id
  assert.ok(otherId)
  await page.waitForFunction(
    (id) => document.querySelector('#quick-note-workspace')?.value === id,
    otherId,
  )
  assert.equal(
    await settings.getByLabel('Workspace', { exact: true }).inputValue(),
    otherId,
  )
  await settings.getByLabel('Folder', { exact: true }).selectOption('Inbox')
  await page.getByRole('button', { name: 'Save settings' }).click()
  const secondDialog = await openCapture(app, page)
  await secondDialog.getByRole('textbox', { name: 'Title' }).fill('Elsewhere')
  await secondDialog
    .getByRole('textbox', { name: 'Note' })
    .fill('Another workspace')
  await saveCapture(secondDialog, 'Elsewhere.md')
  assert.equal(
    await readFile(join(other, 'Inbox', 'Elsewhere.md'), 'utf8'),
    'Another workspace',
  )

  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note settings')
  await page.getByRole('option', { name: /Quick note settings/i }).click()
  await page
    .getByRole('tabpanel', { name: 'Quick note' })
    .getByLabel('Workspace', { exact: true })
    .selectOption('')
  await page.getByRole('button', { name: 'Save settings' }).click()
  const pinnedDialog = await openCapture(app, page)
  await pinnedDialog.getByText(await realpath(workspace)).waitFor()
  await pinnedDialog.getByRole('textbox', { name: 'Title' }).fill('Pinned')
  await pinnedDialog
    .getByRole('textbox', { name: 'Note' })
    .fill('Pinned to original workspace')
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, other)
  const switched = await page.evaluate(() => window.hibi.openWorkspace())
  assert.equal(switched?.id, otherId)
  await saveCapture(pinnedDialog, 'Pinned.md')
  assert.equal(
    await readFile(join(workspace, 'Pinned.md'), 'utf8'),
    'Pinned to original workspace',
  )
  await assert.rejects(readFile(join(other, 'Pinned.md'), 'utf8'), {
    code: 'ENOENT',
  })

  const originalPath = await realpath(workspace)
  const originalId = (
    await page.evaluate(() => window.hibi.getRecentWorkspaces())
  ).find((item) => item.path === originalPath)?.id
  assert.ok(originalId)
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note settings')
  await page.getByRole('option', { name: /Quick note settings/i }).click()
  await page
    .getByRole('tabpanel', { name: 'Quick note' })
    .getByLabel('Workspace', { exact: true })
    .selectOption(originalId)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await page.getByRole('button', { name: 'Back to app' }).click()
  let lastChosen
  for (let number = 0; number < 6; number++) {
    const destination = join(root, `later-${number}`)
    await mkdir(destination)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, destination)
    lastChosen = await page.evaluate(() =>
      window.hibi.invokeAddon('quick-note', 'chooseWorkspace'),
    )
  }
  assert.equal(
    (await page.evaluate(() => window.hibi.getRecentWorkspaces())).some(
      (item) => item.id === originalId,
    ),
    false,
  )
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Quick note settings')
  await page.getByRole('option', { name: /Quick note settings/i }).click()
  const oldSettings = page.getByRole('tabpanel', { name: 'Quick note' })
  await page.waitForFunction(
    (id) => document.querySelector('#quick-note-workspace')?.value === id,
    originalId,
  )
  assert.equal(
    await oldSettings.getByLabel('Workspace', { exact: true }).inputValue(),
    originalId,
  )
  assert.equal(
    await oldSettings.locator(`option[value="${originalId}"]`).innerText(),
    originalPath,
  )
  await page.getByRole('button', { name: 'Back to app' }).click()
  const oldDialog = await openCapture(app, page)
  await oldDialog.getByText(originalPath).waitFor()
  await oldDialog.getByRole('textbox', { name: 'Title' }).fill('Older')
  await oldDialog.getByRole('textbox', { name: 'Note' }).fill('Still selected')
  await saveCapture(oldDialog, 'Older.md')
  assert.equal(
    await readFile(join(workspace, 'Older.md'), 'utf8'),
    'Still selected',
  )

  assert.ok(lastChosen)
  const selected = join(root, 'later-5')
  const moved = join(root, 'moved-later-5')
  const outside = join(root, 'outside')
  await mkdir(outside)
  await rename(selected, moved)
  await symlink(outside, selected, 'junction')
  await assert.rejects(
    page.evaluate(
      (workspaceId) =>
        window.hibi.invokeAddon('quick-note', 'save', {
          workspaceId,
          folder: '',
          title: 'Escape',
          markdown: 'Must stay inside',
        }),
      lastChosen.id,
    ),
    /workspace location changed/i,
  )
  await assert.rejects(readFile(join(outside, 'Escape.md'), 'utf8'), {
    code: 'ENOENT',
  })

  const parent = join(root, 'chosen-parent')
  const nested = join(parent, 'Notes')
  const replacement = join(root, 'replacement-parent')
  await mkdir(nested, { recursive: true })
  await mkdir(join(replacement, 'Notes'), { recursive: true })
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, nested)
  const nestedChosen = await page.evaluate(() =>
    window.hibi.invokeAddon('quick-note', 'chooseWorkspace'),
  )
  await rename(parent, join(root, 'moved-chosen-parent'))
  await symlink(replacement, parent, 'junction')
  await assert.rejects(
    page.evaluate(
      (workspaceId) =>
        window.hibi.invokeAddon('quick-note', 'save', {
          workspaceId,
          folder: '',
          title: 'Ancestor escape',
          markdown: 'Must stay inside',
        }),
      nestedChosen.id,
    ),
    /workspace location changed/i,
  )
  await assert.rejects(
    readFile(join(replacement, 'Notes', 'Ancestor escape.md'), 'utf8'),
    { code: 'ENOENT' },
  )
})

test('quick note shortcut opens one capture window without raising Hibi', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-quick-note-window-'))
  const workspace = join(root, 'workspace')
  const profile = join(root, 'profile')
  await mkdir(workspace, { recursive: true })
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
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, workspace)
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  const workspaceId = (await page.evaluate(() => window.hibi.openWorkspace()))
    .id
  // Record the OS callback so the test can press the shortcut without the OS.
  await app.evaluate(({ globalShortcut }) => {
    globalThis.quickNoteShortcuts = new Map()
    globalShortcut.register = (accelerator, callback) => {
      globalThis.quickNoteShortcuts.set(accelerator, callback)
      return true
    }
    globalShortcut.unregister = (accelerator) =>
      globalThis.quickNoteShortcuts.delete(accelerator)
  })
  const shortcut = 'Control+Alt+Shift+F7'
  await page.evaluate(
    ({ shortcut, workspaceId }) => {
      localStorage.setItem(
        'hibi:quick-note',
        JSON.stringify({ shortcut, workspaceId }),
      )
      window.dispatchEvent(new Event('hibi:quick-note-settings'))
    },
    { shortcut, workspaceId },
  )
  const press = async () => {
    for (;;) {
      const pressed = await app.evaluate((_electron, accelerator) => {
        const callback = globalThis.quickNoteShortcuts.get(accelerator)
        callback?.()
        return !!callback
      }, shortcut)
      if (pressed) return
      await setTimeout(30)
    }
  }
  await watchMainWindow(app)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'app://hibi/')
      .hide(),
  )

  await press()
  const capture = await captureWindow(app)
  await capture.getByRole('textbox', { name: 'Note' }).fill('Keep this')
  const id = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith('addon-window.html'),
      ).webContents.id,
  )
  await press()
  assert.equal(
    (await appWindows(app)).filter((url) => captureUrl.test(url)).length,
    1,
  )
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith('addon-window.html'),
        ).webContents.id,
    ),
    id,
  )

  // Escape closes the window and keeps the unsaved text as a draft. The page
  // can close before Playwright releases the key, so only the close is awaited.
  let closed = capture.waitForEvent('close')
  await capture.keyboard.press('Escape').catch(() => {})
  await closed
  await press()
  const reopened = await captureWindow(app)
  assert.equal(
    await reopened.getByRole('textbox', { name: 'Note' }).inputValue(),
    'Keep this',
  )
  closed = reopened.waitForEvent('close')
  await reopened.keyboard.press('ControlOrMeta+w').catch(() => {})
  await closed

  await press()
  const saving = await captureWindow(app)
  assert.equal(
    await saving.getByRole('textbox', { name: 'Note' }).inputValue(),
    'Keep this',
  )
  await saving
    .getByRole('textbox', { name: 'Note' })
    .press('ControlOrMeta+Enter')
  await saving.getByRole('status').getByText('Saved Quick note.md.').waitFor()
  await saving.waitForEvent('close')
  assert.equal(
    await readFile(join(workspace, 'Quick note.md'), 'utf8'),
    'Keep this',
  )
  assert.equal(await mainWindowRaised(app), 0)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'app://hibi/')
        .isVisible(),
    ),
    false,
  )

  await press()
  const empty = await captureWindow(app)
  assert.equal(
    await empty.getByRole('textbox', { name: 'Note' }).inputValue(),
    '',
  )
  closed = empty.waitForEvent('close')
  await empty.keyboard.press('Escape').catch(() => {})
  await closed

  if (process.platform !== 'darwin') return
  // macOS keeps Hibi and its shortcut running after the last window closes.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'app://hibi/')
      .close(),
  )
  for (;;) {
    if ((await appWindows(app)).length === 0) break
    await setTimeout(30)
  }
  await press()
  const windowless = await captureWindow(app)
  await windowless.getByRole('textbox', { name: 'Note' }).fill('No main window')
  await saveCapture(windowless, 'Quick note 2.md')
  assert.equal(
    await readFile(join(workspace, 'Quick note 2.md'), 'utf8'),
    'No main window',
  )
  assert.deepEqual(await appWindows(app), [])
})
