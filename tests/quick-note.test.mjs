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
      await page.locator('.tiptap[contenteditable="true"]').waitFor()
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

// The capture window stays alive hidden, so count hides instead of closes.
const trackCaptureHides = (app) =>
  app.evaluate(({ app }) => {
    globalThis.captureHides = 0
    app.on('browser-window-created', (_event, window) => {
      const hide = window.hide.bind(window)
      window.hide = () => {
        globalThis.captureHides++
        return hide()
      }
    })
  })
const captureHides = (app) => app.evaluate(() => globalThis.captureHides)
async function hidden(app, before) {
  while ((await captureHides(app)) <= before) await setTimeout(30)
}

/** Replace the note with Markdown typed line by line. */
async function writeNote(capture, ...lines) {
  const editor = capture.locator('.tiptap[contenteditable="true"]')
  await editor.click()
  await capture.keyboard.press('ControlOrMeta+a')
  await capture.keyboard.press('Backspace')
  for (const [index, line] of lines.entries()) {
    if (index) await capture.keyboard.press('Enter')
    await capture.keyboard.type(line)
  }
}

async function saveCapture(app, capture, name) {
  const before = await captureHides(app)
  await capture.getByRole('button', { name: 'Save', exact: true }).click()
  await capture.getByRole('status').getByText(`Saved ${name}.`).waitFor()
  await hidden(app, before)
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
  await trackCaptureHides(app)
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
  await defaultCapture.getByText('workspace', { exact: true }).waitFor()
  const urls = await appWindows(app)
  assert.equal(urls.length, 2)
  assert.equal(urls.filter((url) => captureUrl.test(url)).length, 1)
  assert.equal(await defaultCapture.locator('.editor-toolbar').count(), 1)
  await writeNote(defaultCapture, 'Default thought')
  await saveCapture(app, defaultCapture, 'Quick note.md')
  assert.equal(
    await readFile(join(workspace, 'Quick note.md'), 'utf8'),
    'Default thought',
  )
  assert.equal(await mainWindowRaised(app), 0)
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
  // Ask for a title starts the note with the default title as its heading.
  await dialog.locator('.tiptap h1').getByText('Draft').waitFor()
  await writeNote(dialog, '# Daily', 'First thought')
  await saveCapture(app, dialog, 'Daily.md')
  assert.equal(
    await readFile(join(folder, 'Daily.md'), 'utf8'),
    '# Daily\n\nFirst thought',
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
    '# Daily\n\nFirst thought',
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
  await writeNote(secondDialog, '# Elsewhere', 'Another workspace')
  await saveCapture(app, secondDialog, 'Elsewhere.md')
  assert.equal(
    await readFile(join(other, 'Inbox', 'Elsewhere.md'), 'utf8'),
    '# Elsewhere\n\nAnother workspace',
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
  await pinnedDialog
    .locator(`[data-tooltip="${await realpath(workspace)}"]`)
    .getByText('workspace', { exact: true })
    .waitFor()
  await writeNote(pinnedDialog, '# Pinned', 'Pinned to original workspace')
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    })
  }, other)
  const switched = await page.evaluate(() => window.hibi.openWorkspace())
  assert.equal(switched?.id, otherId)
  await saveCapture(app, pinnedDialog, 'Pinned.md')
  assert.equal(
    await readFile(join(workspace, 'Pinned.md'), 'utf8'),
    '# Pinned\n\nPinned to original workspace',
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
  await oldDialog.locator(`[data-tooltip="${originalPath}"]`).waitFor()
  await writeNote(oldDialog, '# Older', 'Still selected')
  await saveCapture(app, oldDialog, 'Older.md')
  assert.equal(
    await readFile(join(workspace, 'Older.md'), 'utf8'),
    '# Older\n\nStill selected',
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
  await trackCaptureHides(app)
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

  const noteText = async (capture) =>
    (
      await capture.locator('.tiptap[contenteditable="true"]').innerText()
    ).trim()
  const closeWith = async (capture, key) => {
    const before = await captureHides(app)
    await capture.keyboard.press(key)
    await hidden(app, before)
  }

  await press()
  const capture = await captureWindow(app)
  await writeNote(capture, 'Keep this')
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

  // Escape and Cmd/Ctrl+W hide the window and keep the unsaved note, also on disk.
  await closeWith(capture, 'Escape')
  assert.match(
    await capture.evaluate(() => localStorage.getItem('hibi:quick-note-draft')),
    /Keep this/,
  )
  await press()
  assert.equal(await noteText(await captureWindow(app)), 'Keep this')
  await closeWith(capture, 'ControlOrMeta+w')

  await press()
  const saving = await captureWindow(app)
  assert.equal(await noteText(saving), 'Keep this')
  const before = await captureHides(app)
  await saving.keyboard.press('ControlOrMeta+Enter')
  await saving.getByRole('status').getByText('Saved Quick note.md.').waitFor()
  await hidden(app, before)
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

  // The next capture starts empty.
  await press()
  const empty = await captureWindow(app)
  assert.equal(await noteText(empty), '')
  await closeWith(empty, 'Escape')

  if (process.platform !== 'darwin') return
  // macOS keeps Hibi and its shortcut running after the last window closes.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'app://hibi/')
      .close(),
  )
  while ((await appWindows(app)).includes('app://hibi/')) await setTimeout(30)
  await press()
  const windowless = await captureWindow(app)
  await writeNote(windowless, 'No main window')
  await saveCapture(app, windowless, 'Quick note 2.md')
  assert.equal(
    await readFile(join(workspace, 'Quick note 2.md'), 'utf8'),
    'No main window',
  )
  assert.equal((await appWindows(app)).includes('app://hibi/'), false)
})
