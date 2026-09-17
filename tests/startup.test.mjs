import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'

test('startup placeholder stays out of documents and reopens persisted recent workspaces', {
  timeout: 45000,
}, async (t) => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'hibi-startup-')))
  const profile = join(temp, 'profile')
  let app
  async function launch() {
    app = await electron.launch({
      args: [resolve('.'), `--user-data-dir=${profile}`],
    })
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(6500)
    await page.getByRole('textbox', { name: 'document editor' }).waitFor()
    return page
  }
  t.after(async () => {
    await app?.close()
    await rm(temp, { recursive: true, force: true })
  })
  let page = await launch()
  const welcome = () => page.getByRole('region', { name: 'start writing' })
  await welcome().getByRole('heading', { name: 'start typing' }).waitFor()
  await welcome().getByText('no recent workspaces yet.').waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '',
  )
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.press('a')
  await welcome().waitFor({ state: 'hidden' })
  await rich.fill('')
  assert.equal(await welcome().count(), 0)
  await pressShortcut(app, 'Meta+n')
  assert.equal(await welcome().count(), 0)

  const folders = []
  for (let index = 1; index <= 6; index++) {
    const path = join(temp, `workspace ${index}`)
    folders.unshift(path)
    await mkdir(path)
    await writeFile(join(path, 'empty.md'), '')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, path)
    await page.evaluate(() => window.hibi.openWorkspace())
  }
  const recent = await page.evaluate(() => window.hibi.getRecentWorkspaces())
  assert.deepEqual(
    recent.map((item) => item.path),
    folders.slice(0, 5),
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.openRecentWorkspace('/unapproved/path')),
    /recent list/,
  )
  await page.evaluate((id) => window.hibi.openRecentWorkspace(id), recent[1].id)
  const reordered = [folders[1], folders[0], ...folders.slice(2, 5)]
  assert.deepEqual(
    JSON.parse(await readFile(join(profile, 'recent-workspaces.json'), 'utf8')),
    reordered,
  )
  await app.close()
  app = null

  // A fresh process has an empty startup draft and the same workspace history.
  page = await launch()
  await welcome()
    .getByRole('button', { name: reordered[0], exact: true })
    .waitFor()
  assert.equal(await welcome().locator('li').count(), 5)
  await rm(reordered[0], { recursive: true })
  await welcome()
    .getByRole('button', { name: reordered[0], exact: true })
    .click()
  await page
    .locator('.toast')
    .filter({ hasText: /ENOENT|no such file/ })
    .waitFor()
  assert.equal(await welcome().isVisible(), true)
  await welcome()
    .getByRole('button', { name: reordered[1], exact: true })
    .click()
  await welcome().waitFor({ state: 'hidden' })
  await page.getByRole('treeitem', { name: 'empty.md', exact: true }).click()
  assert.equal(await welcome().count(), 0)
  await page.locator('.tiptap p[data-placeholder="start typing"]').waitFor()
  assert.equal(
    await page.locator('.tiptap p').getAttribute('data-placeholder'),
    'start typing',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '',
  )
  await app.close()
  app = null

  page = await launch()
  await welcome().getByRole('button', { name: 'dismiss this' }).click()
  await welcome().waitFor({ state: 'hidden' })
  assert.equal(
    await page
      .getByRole('textbox', { name: 'document editor' })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await page.reload()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  assert.equal(await welcome().count(), 0)
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '',
  )
})
