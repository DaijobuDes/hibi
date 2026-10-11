import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    const focused = await page.evaluate(() =>
      document.activeElement?.textContent?.trim(),
    )
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
  await tabTo(page, 'Dark')
  await page.keyboard.press('Enter')
  await waitForAppState(
    page,
    () =>
      JSON.parse(localStorage.getItem('hibi-colorscheme') ?? '{}').mode ===
      'dark',
  )
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Dark' })
      .getAttribute('aria-pressed'),
    'true',
  )

  await tabTo(page, 'Continue')
  await page.keyboard.press('Enter')
  await dialog.getByRole('heading', { name: 'How you write' }).waitFor()
  await tabTo(page, 'Source view')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => localStorage.getItem('default-view')),
    'markdown',
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
    process.platform === 'darwin' ? '⌘' : 'Ctrl',
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
})
