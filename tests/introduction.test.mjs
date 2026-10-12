import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  electron,
  waitForAppState,
  waitForDocumentEditor,
} from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

async function setup(t, prefix) {
  const temp = await mkdtemp(join(tmpdir(), prefix))
  const profile = join(temp, 'profile')
  let app
  const close = async () => {
    await app?.close()
    app = null
  }
  t.after(async () => {
    await close()
    await rm(temp, { recursive: true, force: true })
  })
  return {
    temp,
    close,
    async launch(...args) {
      await close()
      app = await electron.launch({
        args: [resolve('.'), `--user-data-dir=${profile}`, ...args],
      })
      const page = await app.firstWindow()
      page.setDefaultTimeout(6500)
      await page.locator('.titlebar').waitFor()
      return { app, page }
    },
  }
}

const introduction = (page) =>
  page.getByRole('dialog', { name: 'Introduction' })
const stored = (page) =>
  page.evaluate(() => localStorage.getItem('introduction'))

// Moves focus with Tab only, so each step is reachable without a pointer.
async function tabTo(page, name) {
  for (let presses = 0; presses < 20; presses += 1) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const element = document.activeElement
      return (element?.closest('label') ?? element)?.textContent?.trim()
    })
    if (focused === name) return
  }
  throw new Error(`Tab never reached ${name}`)
}

test('the introduction waits for a launch without files and stays dismissed after skipping', {
  timeout: 60000,
}, async (t) => {
  const session = await setup(t, 'hibi-introduction-')
  const file = join(session.temp, 'note.md')
  await writeFile(file, '# Note\n')

  // Development and test launches never show it unless asked.
  let { page } = await session.launch()
  assert.equal(await stored(page), 'pending')
  assert.equal(await introduction(page).count(), 0)

  const withFile = await session.launch('--hibi-introduction', file)
  page = withFile.page
  await waitForDocumentEditor(withFile.app, page)
  assert.match(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    /# Note/,
  )
  assert.equal(await introduction(page).count(), 0)
  assert.equal(await stored(page), 'pending')

  ;({ page } = await session.launch('--hibi-introduction'))
  const dialog = introduction(page)
  await dialog.getByRole('heading', { name: 'Welcome to Hibi' }).waitFor()
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    'Welcome to Hibi',
  )
  await dialog.getByRole('button', { name: 'Skip' }).waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await stored(page), 'seen')

  ;({ page } = await session.launch('--hibi-introduction'))
  await waitForAppState(
    page,
    () => !!document.querySelector('.startup-placeholder'),
  )
  assert.equal(await introduction(page).count(), 0)
})

test('keyboard-only completion applies the appearance and default view', {
  timeout: 60000,
}, async (t) => {
  const session = await setup(t, 'hibi-introduction-keys-')
  await session.launch()
  const { app, page } = await session.launch('--hibi-introduction')
  const dialog = introduction(page)
  await dialog.getByRole('heading', { name: 'Welcome to Hibi' }).waitFor()

  await tabTo(page, 'Continue')
  await page.keyboard.press('Enter')
  await dialog.getByRole('heading', { name: 'Make it yours' }).waitFor()
  // Tab enters each choice group on its selection; arrow keys move it.
  await tabTo(page, 'System')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await waitForAppState(
    page,
    () =>
      JSON.parse(localStorage.getItem('hibi-colorscheme') ?? '{}').mode ===
      'dark',
  )
  assert.equal(
    await dialog.getByRole('radio', { name: 'Dark' }).isChecked(),
    true,
  )

  await tabTo(page, 'Continue')
  await page.keyboard.press('Enter')
  await dialog.getByRole('heading', { name: 'How you write' }).waitFor()
  await tabTo(page, 'Normal')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await waitForAppState(
    page,
    () => localStorage.getItem('default-view') === 'markdown',
  )

  for (const title of ['Your files', 'Addons', 'Essentials']) {
    await tabTo(page, 'Continue')
    await page.keyboard.press('Enter')
    await dialog.getByRole('heading', { name: title }).waitFor()
  }
  // Shortcuts come from the hotkey registry rather than fixed copy.
  const palette = await page.evaluate(
    async () => (await window.hibi.bootstrap.document()).hotkeys.palette,
  )
  assert.ok(palette)
  assert.equal(
    await dialog.locator('.introduction-shortcuts kbd').first().textContent(),
    process.platform === 'darwin' ? '⌘' : 'ctrl',
  )

  await tabTo(page, 'Start writing')
  await page.keyboard.press('Enter')
  await dialog.waitFor({ state: 'detached' })
  await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
  assert.equal(await stored(page), 'seen')
  assert.equal(
    await page
      .getByRole('button', { name: 'Source view', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
})

test('the command palette and About settings reopen the introduction', {
  timeout: 45000,
}, async (t) => {
  const session = await setup(t, 'hibi-introduction-palette-')
  const { app, page } = await session.launch()
  await clickMenu(app, 'Command palette')
  const palette = page.getByRole('dialog', { name: /^command palette$/i })
  await palette
    .getByRole('combobox', { name: /search commands/i })
    .fill('show introduction')
  await palette.locator('[id="command-app.introduction"]').click()
  const dialog = introduction(page)
  await dialog.getByRole('heading', { name: 'Welcome to Hibi' }).waitFor()
  await dialog.getByRole('button', { name: 'Skip' }).click()
  await dialog.waitFor({ state: 'detached' })

  await clickMenu(app, 'Settings')
  await page.getByRole('tab', { name: 'About', exact: true }).click()
  await page.getByRole('button', { name: 'Show introduction' }).click()
  await dialog.getByRole('heading', { name: 'Welcome to Hibi' }).waitFor()
  await dialog.getByRole('button', { name: 'Skip' }).click()
  await dialog.waitFor({ state: 'detached' })

  // The palette entry leaves Settings the same way the About entry does.
  await clickMenu(app, 'Settings')
  await waitForAppState(
    page,
    () => !!document.querySelector('.settings-screen:not([hidden])'),
  )
  await clickMenu(app, 'Command palette')
  await palette
    .getByRole('combobox', { name: /search commands/i })
    .fill('show introduction')
  await palette.locator('[id="command-app.introduction"]').click()
  await dialog.getByRole('button', { name: 'Skip' }).click()
  await dialog.waitFor({ state: 'detached' })
  await waitForAppState(
    page,
    () =>
      !document.querySelector('.settings-screen:not([hidden])') &&
      document.querySelector('.editor-page')?.inert === false,
  )
})

test('navigation waits for a pending open and then advances from its own step', {
  timeout: 45000,
}, async (t) => {
  const session = await setup(t, 'hibi-introduction-open-')
  const file = join(session.temp, 'note.md')
  await writeFile(file, '# Note\n')
  await session.launch()
  const { app, page } = await session.launch('--hibi-introduction')
  const dialog = introduction(page)
  for (const title of ['Make it yours', 'How you write', 'Your files']) {
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await dialog.getByRole('heading', { name: title }).waitFor()
  }
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        globalThis.releaseOpen = () =>
          resolve({ canceled: false, filePaths: [path] })
      })
  }, file)
  await dialog.getByRole('button', { name: /Open a file/ }).click()
  await waitForAppState(page, () =>
    [...document.querySelectorAll('.introduction .dialog-footer button')].every(
      (button) => button.disabled,
    ),
  )
  await waitForAppState(app, () => typeof globalThis.releaseOpen === 'function')
  await app.evaluate(() => globalThis.releaseOpen())
  await dialog.getByRole('heading', { name: 'Addons' }).waitFor()
  await waitForAppState(page, async () =>
    /# Note/.test((await window.hibi.getDocument()).markdown),
  )
  assert.equal(
    await dialog.getByRole('button', { name: 'Continue' }).isDisabled(),
    false,
  )
})

test('a file opened from outside closes the automatic introduction and keeps it pending', {
  timeout: 45000,
}, async (t) => {
  const session = await setup(t, 'hibi-introduction-external-')
  const file = join(session.temp, 'note.md')
  await writeFile(file, '# Note\n')
  await session.launch()
  const { app, page } = await session.launch('--hibi-introduction')
  const dialog = introduction(page)
  await dialog.getByRole('heading', { name: 'Welcome to Hibi' }).waitFor()
  await app.evaluate(
    ({ app }, path) => app.emit('open-file', { preventDefault() {} }, path),
    file,
  )
  await dialog.waitFor({ state: 'detached' })
  await waitForAppState(page, async () =>
    /# Note/.test((await window.hibi.getDocument()).markdown),
  )
  assert.equal(await stored(page), 'pending')
})

test('existing profiles skip the introduction and a restored workspace does not defer it', {
  timeout: 60000,
}, async (t) => {
  const existing = await setup(t, 'hibi-introduction-existing-')
  let { page } = await existing.launch()
  // Profiles from before the introduction already store a default view.
  await page.evaluate(() => {
    localStorage.removeItem('introduction')
    localStorage.setItem('default-view', 'normal')
  })
  ;({ page } = await existing.launch('--hibi-introduction'))
  await waitForAppState(
    page,
    () => !!document.querySelector('.startup-placeholder'),
  )
  assert.equal(await stored(page), 'seen')
  assert.equal(await introduction(page).count(), 0)
  await existing.close()

  const session = await setup(t, 'hibi-introduction-workspace-')
  const folder = join(session.temp, 'workspace')
  await mkdir(folder)
  await writeFile(join(folder, 'note.md'), '# Note\n')
  await session.launch()
  await session.close()
  await writeFile(
    join(session.temp, 'profile', 'workspace-settings.json'),
    JSON.stringify({
      enabled: false,
      path: null,
      startup: 'folder',
      startupFolder: folder,
    }),
  )
  ;({ page } = await session.launch('--hibi-introduction'))
  await introduction(page)
    .getByRole('heading', { name: 'Welcome to Hibi' })
    .waitFor()
  await waitForAppState(
    page,
    async () => (await window.hibi.getWorkspace())?.name === 'workspace',
  )
  assert.equal(await introduction(page).count(), 1)
})
