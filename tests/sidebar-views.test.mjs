import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'

test('sidebar starts hidden, stays open while typing, and navigates the page outline in either editor', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-sidebar-views-'))
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
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  assert.equal(await page.locator('.app').getAttribute('data-sidebar'), 'false')
  await page
    .getByRole('button', { name: /^markdown only$/i, exact: true })
    .click()
  const source = page.getByRole('textbox', { name: /markdown editor/i })
  const text =
    '# alpha\n\n' +
    'paragraph\n\n'.repeat(40) +
    '## second\n\n```md\n# code example\n```\n'
  await source.fill(text)
  await page
    .getByRole('button', { name: /^sidebar views$/i, exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: /^in this page$/i, exact: true })
    .click()
  const outline = page.getByRole('tree', { name: /in this page/i })
  await outline
    .getByRole('treeitem', { name: /^second$/i, exact: true })
    .waitFor()
  assert.equal(await outline.getByRole('treeitem').count(), 2)
  await outline
    .getByRole('treeitem', { name: /^second$/i, exact: true })
    .click()
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains('cm-content'),
  )
  assert.match(
    await page.evaluate(
      () =>
        window.getSelection()?.anchorNode?.parentElement?.closest('.cm-line')
          ?.textContent,
    ),
    /second/,
  )
  await source.press('End')
  await source.press('x')
  assert.equal(await page.locator('.app').getAttribute('data-sidebar'), 'true')
  await outline
    .getByRole('treeitem', { name: /^secondx$/i, exact: true })
    .waitFor()
  await page.getByRole('button', { name: /^normal$/i, exact: true }).click()
  await outline.getByRole('treeitem', { name: /^alpha$/i, exact: true }).click()
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains('tiptap'),
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.getSelection()?.anchorNode?.parentElement?.closest('h1')
          ?.textContent,
    ),
    'alpha',
  )
  await pressShortcut(
    app,
    process.platform === 'darwin' ? 'Meta+/' : 'Control+/',
  )
  assert.equal(await page.locator('.app').getAttribute('data-sidebar'), 'false')
  await pressShortcut(
    app,
    process.platform === 'darwin' ? 'Meta+/' : 'Control+/',
  )
  await outline.waitFor()
  await page
    .getByRole('button', { name: /^sidebar views$/i, exact: true })
    .click()
  await page
    .getByRole('menuitem', { name: /^workspace$/i, exact: true })
    .click()
  await page
    .getByRole('button', { name: /^open workspace$/i, exact: true })
    .waitFor()
  await page.reload()
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  assert.equal(await page.locator('.app').getAttribute('data-sidebar'), 'false')
})
