import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'

test('code highlighting controls update both panes, persist, and discover addon languages', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-code-syntax-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(6500)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await pressShortcut(app, `${mod}+Shift+]`)
  const original = '```js\nconst answer = 42\n```'
  await page.getByRole('textbox', { name: 'markdown editor' }).fill(original)
  await page
    .locator('.source-pane .hibi-token-keyword')
    .filter({ hasText: 'const' })
    .waitFor()
  await page
    .getByRole('button', { name: 'editor settings', exact: true })
    .click()
  await page
    .getByRole('tab', { name: 'code highlighting', exact: true })
    .click()
  await page.getByRole('checkbox', { name: 'javascript', exact: true }).click()
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.source-pane .hibi-token-keyword')].some(
        (element) => element.textContent === 'const',
      ) && !document.querySelector('.tiptap pre .hibi-token-keyword'),
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    original,
  )
  await page.reload()
  await page
    .getByRole('button', { name: 'editor settings', exact: true })
    .click()
  await page
    .getByRole('tab', { name: 'code highlighting', exact: true })
    .click()
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'javascript', exact: true })
      .isChecked(),
    false,
  )
  await page.getByRole('checkbox', { name: 'javascript', exact: true }).click()
  await page
    .locator('.tiptap pre .hibi-token-keyword')
    .waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  await page.locator('#addon-typst').click()
  await page
    .getByRole('tab', { name: 'code highlighting', exact: true })
    .click()
  await page.getByRole('checkbox', { name: 'typst', exact: true }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    original,
  )
})
