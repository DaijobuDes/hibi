import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'

test('command palette, full-height settings, and local geist fonts', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-palette-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
    colorScheme: null,
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  await rich.fill('keep this draft')
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p',
  )
  const palette = page.getByRole('dialog', { name: 'command palette' })
  const search = page.getByRole('combobox', { name: 'search commands' })
  await palette.waitFor()
  await search.fill('side-by-side')
  await search.press('Enter')
  await palette.waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: 'markdown editor' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'keep this draft',
  )
  await page.evaluate(() => document.fonts.ready.then(() => true))
  assert.deepEqual(
    await page.evaluate(() =>
      ['Geist', 'Geist Mono'].map((family) =>
        [...document.fonts].some(
          (font) => font.family === family && font.status === 'loaded',
        ),
      ),
    ),
    [true, true],
  )

  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  await search.fill('preferences settings')
  await search.press('Enter')
  await palette.waitFor({ state: 'hidden' })
  const settings = page.getByRole('main', { name: 'settings', exact: true })
  await settings.waitFor()
  assert.deepEqual(
    await page.evaluate(() => {
      const sidebar = document
        .querySelector('.settings-sidebar')
        .getBoundingClientRect()
      return {
        top: sidebar.top,
        height: sidebar.height,
        viewport: innerHeight,
        wrapper: Boolean(document.querySelector('.settings-sidebar summary')),
      }
    }),
    {
      top: 0,
      height: await page.evaluate(() => innerHeight),
      viewport: await page.evaluate(() => innerHeight),
      wrapper: false,
    },
  )
  for (const name of [
    'new',
    'open',
    'save',
    'format',
    'normal',
    'side-by-side',
    'markdown only',
  ]) {
    assert.equal(
      await page.getByRole('button', { name, exact: true }).count(),
      0,
      name,
    )
  }
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/settings.png' })

  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  await search.fill('no matching action')
  await page
    .getByRole('status')
    .filter({ hasText: 'no commands found.' })
    .waitFor()
  await search.press('Escape')
  await palette.waitFor({ state: 'hidden' })
  assert.equal(await settings.isVisible(), true)
  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  const first = await search.getAttribute('aria-activedescendant')
  await search.press('ArrowDown')
  assert.notEqual(await search.getAttribute('aria-activedescendant'), first)
  await palette.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )
  await page.screenshot({ path: 'test-results/command-palette.png' })
  await search.press('Escape')
  await palette.waitFor({ state: 'hidden' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  await palette.waitFor()
  assert.equal(
    await palette.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
    'none',
  )
  await search.fill('back to editor')
  await search.press('Enter')
  await rich.waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'keep this draft',
  )
  assert.deepEqual(errors, [])
})
