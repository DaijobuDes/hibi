import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'

test('find in note searches rich text and offscreen markdown without editing it', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-find-'))
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
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
  const markdown = '# title\n\nhello **world** and hello world.\n\nHELLO world.'
  await source.fill(markdown)
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  await rich.waitFor()
  const shortcut = process.platform === 'darwin' ? 'Meta+f' : 'Control+f'
  await pressShortcut(app, shortcut)
  const input = page.getByRole('textbox', { name: 'find in note', exact: true })
  const bar = page.getByRole('search', { name: 'find in note' })
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('.find-bar').getBoundingClientRect().top -
          document.querySelector('.titlebar').getBoundingClientRect().bottom,
      ) < 1,
  )
  const waitForCount = (expected) =>
    page.waitForFunction(
      (count) =>
        document.querySelector('.find-bar output')?.textContent === count,
      expected,
    )
  await input.fill('hello world')
  await page.waitForFunction(
    () => document.querySelector('.find-bar output')?.textContent === '1/3',
  )
  assert.equal(
    await input.evaluate((element) => element === document.activeElement),
    true,
  )
  await input.press('Enter')
  await waitForCount('2/3')
  await input.press('Shift+Enter')
  await waitForCount('1/3')
  await input.press('Shift+Enter')
  await waitForCount('3/3')
  await page.getByRole('button', { name: 'next match', exact: true }).click()
  await waitForCount('1/3')
  await rich.click()
  await pressShortcut(app, shortcut)
  assert.equal(
    await input.evaluate((element) => element === document.activeElement),
    true,
  )
  await input.press('Enter')
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    markdown,
  )
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/find-in-note.png' })
  await input.press('Escape')
  await bar.waitFor({ state: 'hidden' })
  assert.equal(
    await rich.evaluate((element) => element === document.activeElement),
    true,
  )

  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  await source.waitFor()
  await pressShortcut(app, shortcut)
  await page.waitForFunction(
    () => document.querySelector('.find-bar output')?.textContent === '1/2',
  )
  await input.press('Enter')
  await waitForCount('2/2')
  assert.equal(
    await input.evaluate((element) => element === document.activeElement),
    true,
  )
  await input.fill('settings')
  await page.waitForFunction(
    () =>
      document.querySelector('.find-bar output')?.textContent === 'no results',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'next match', exact: true })
      .isDisabled(),
    true,
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    markdown,
  )

  await source.fill(
    `${Array.from({ length: 150 }, (_, index) => `line ${index}`).join('\n')}\nlast needle`,
  )
  await input.fill('last needle')
  await page.waitForFunction(
    () => document.querySelector('.find-bar output')?.textContent === '1/1',
  )
  await source
    .locator('.cm-searchMatch')
    .filter({ hasText: 'last needle' })
    .waitFor()
  await page.getByRole('button', { name: 'close find', exact: true }).click()
  await bar.waitFor({ state: 'hidden' })
  assert.equal(
    await source.evaluate((element) => element === document.activeElement),
    true,
  )

  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  await source.waitFor()
  await source.focus()
  await pressShortcut(app, shortcut)
  await waitForCount('1/1')
  await source.locator('.cm-searchMatch-selected').waitFor()
  assert.equal(await source.locator('.cm-searchMatch-selected').count(), 1)
  await rich.focus()
  await pressShortcut(app, shortcut)
  await waitForCount('1/1')
  await rich.locator('.ProseMirror-active-search-match').waitFor()
  assert.equal(
    await rich.locator('.ProseMirror-active-search-match').count(),
    1,
  )
  await input.press('Escape')
  await bar.waitFor({ state: 'hidden' })
})
