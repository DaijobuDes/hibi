import assert from 'node:assert/strict'
import {
  access,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('workspace popovers, durable folders, ephemeral files, inline rename, dirty state, and safe file actions', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-explorer-profile-'))
  const root = await mkdtemp(join(tmpdir(), 'hibi-explorer-files-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, root)
  const page = await app.firstWindow()
  page.setDefaultTimeout(7000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await pressShortcut(app, `${mod}+Shift+o`)
  await page.getByRole('button', { name: 'new workspace folder' }).click()
  const rename = page.getByRole('textbox', { name: 'rename item' })
  await rename.waitFor()
  const renameStyle = await rename.evaluate((input) => {
    const style = getComputedStyle(input)
    return { border: style.borderTopWidth, background: style.backgroundColor }
  })
  assert.deepEqual(renameStyle, {
    border: '0px',
    background: 'rgba(0, 0, 0, 0)',
  })
  await access(join(root, 'untitled folder'))
  await rename.fill('guides')
  await rename.press('Enter')
  await rename.waitFor({ state: 'hidden' })
  await access(join(root, 'guides'))
  const more = page.getByRole('button', { name: 'actions for guides' })
  await more.click()
  const menu = page.getByRole('menu', { name: 'actions for guides' })
  await menu.waitFor()
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () => !document.querySelector('.ui-menu').matches(':popover-open'),
  )
  await more.click()
  await menu.getByRole('menuitem', { name: 'new file', exact: true }).click()
  await rename.waitFor()
  await assert.rejects(access(join(root, 'guides', 'untitled.md')))
  await rename.fill('hello.md')
  await rename.press('Enter')
  await rename.waitFor({ state: 'hidden' })
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await page.waitForFunction(
    () =>
      document.querySelector('.tiptap')?.getAttribute('contenteditable') ===
      'true',
  )
  await rich.fill('unsaved text')
  assert.equal(await page.locator('.sidebar-dirty').count(), 1)
  await assert.rejects(access(join(root, 'guides', 'hello.md')))
  await pressShortcut(app, `${mod}+s`)
  await waitForAsync(page, async () => !(await window.hibi.getDocument()).dirty)
  assert.equal(
    await readFile(join(root, 'guides', 'hello.md'), 'utf8'),
    'unsaved text',
  )
  await page.waitForFunction(() => !document.querySelector('.sidebar-dirty'))
  await rich.fill('still editing')
  await page.getByRole('button', { name: 'actions for hello.md' }).click()
  await page.getByRole('menuitem', { name: 'rename', exact: true }).click()
  await rename.fill('renamed.md')
  await rename.press('Enter')
  await rename.waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'still editing',
  )
  await page.evaluate(() =>
    window.hibi.workspaceAction({
      action: 'duplicate',
      path: 'guides/renamed.md',
    }),
  )
  assert.equal(
    await readFile(join(root, 'guides', 'renamed copy.md'), 'utf8'),
    'unsaved text',
  )
  await assert.rejects(
    page.evaluate(() =>
      window.hibi.workspaceAction({
        action: 'rename',
        path: 'guides/renamed.md',
        destination: 'renamed copy.md',
      }),
    ),
    /already exists/,
  )
  await assert.rejects(
    page.evaluate(() =>
      window.hibi.workspaceAction({ action: 'delete', path: '../outside.md' }),
    ),
    /valid.*name/,
  )
  await symlink(profile, join(root, 'escape'))
  await assert.rejects(
    page.evaluate(() =>
      window.hibi.workspaceAction({ action: 'new-file', path: 'escape' }),
    ),
    /symlink/,
  )
  await page.evaluate(() =>
    window.hibi.workspaceAction({
      action: 'move',
      path: 'guides/renamed.md',
      destination: 'moved.md',
    }),
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'still editing',
  )
  await assert.rejects(access(join(root, 'guides', 'renamed.md')))
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 })
  })
  await page.evaluate(() =>
    window.hibi.workspaceAction({ action: 'new-file', path: '' }),
  )
  await writeFile(join(root, 'untitled.md'), 'external file')
  await assert.rejects(
    page.evaluate(() => window.hibi.saveDocument(false)),
    /EEXIST/,
  )
  assert.equal(
    await readFile(join(root, 'untitled.md'), 'utf8'),
    'external file',
  )
})
