import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
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

test('file picker and drops attach media safely, stream videos, and move/open workspace items', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-media-'))
  const workspace = join(root, 'notes')
  await mkdir(join(workspace, 'folder'), { recursive: true })
  await writeFile(join(workspace, 'one.md'), '# one')
  await writeFile(join(workspace, 'two.md'), '# two')
  const gif = join(root, 'animation.gif')
  await writeFile(
    gif,
    Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    ),
  )
  const video = resolve('tests/fixtures/clip.webm')
  const tricky = join(root, 'bracket ](.gif')
  await writeFile(tricky, await readFile(gif))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(root, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  await app.evaluate(
    ({ dialog }, { gif, workspace }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [gif],
      })
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: `${workspace}/attached.md`,
      })
      dialog.showMessageBox = async () => ({ response: 1 })
    },
    { gif, workspace },
  )
  async function choose(name) {
    await pressShortcut(app, `${mod}+k`)
    const palette = page.getByRole('dialog', { name: 'command palette' })
    await palette.getByRole('combobox').fill(name)
    await palette
      .getByRole('option')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
      .click()
  }
  await rich.fill('hello')
  await choose('image')
  await rich.locator('img').waitFor()
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.includes('assets/animation.gif'),
  )
  assert.deepEqual(
    await readFile(join(workspace, 'assets/animation.gif')),
    await readFile(gif),
  )
  assert.equal(
    await page.getByRole('dialog', { name: 'insert image' }).count(),
    0,
  )
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.id = 'fixture-file'
    input.hidden = true
    document.body.append(input)
  })
  async function drop(paths, locator = rich) {
    await page.locator('#fixture-file').setInputFiles(paths)
    const transfer = await page
      .locator('#fixture-file')
      .evaluateHandle((input) => {
        const data = new DataTransfer()
        for (const file of input.files) data.items.add(file)
        return data
      })
    await locator.dispatchEvent('drop', { dataTransfer: transfer })
    await transfer.dispose()
  }
  await drop([gif, video, tricky])
  await rich.locator('img[alt="bracket ]("]').waitFor()
  const movie = rich.locator('video')
  await movie.waitFor()
  await page.waitForFunction(
    () => document.querySelector('.tiptap video')?.readyState >= 1,
  )
  assert.equal(await movie.getAttribute('controls'), '')
  const url = await movie.getAttribute('src')
  assert.match(url, /^app:\/\/hibi\/document-media\//)
  const range = await page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-15' } })
    return {
      status: response.status,
      size: (await response.arrayBuffer()).byteLength,
    }
  }, url)
  assert.deepEqual(range, { status: 206, size: 16 })
  assert.ok(
    (await readdir(join(workspace, 'assets'))).includes('animation-2.gif'),
  )
  await pressShortcut(app, `${mod}+Shift+]`)
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
  await source.press(`${mod}+End`)
  await drop(gif, source)
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.includes('animation-3.gif'),
  )
  await pressShortcut(app, `${mod}+s`)
  await waitForAsync(page, async () => !(await window.hibi.getDocument()).dirty)
  await page.waitForFunction(
    () => document.querySelector('.app').getAttribute('aria-busy') === 'false',
  )
  const cdp = await page.context().newCDPSession(page)
  const folderDrop = {
    x: 400,
    y: 300,
    data: { items: [], files: [workspace], dragOperationsMask: 1 },
  }
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await cdp.send('Input.dispatchDragEvent', { type, ...folderDrop })
  await cdp.detach()
  await waitForAsync(
    page,
    async () => (await window.hibi.getWorkspace())?.name === 'notes',
  )
  const snapshot = await page.evaluate(() => window.hibi.getWorkspaceSnapshot())
  assert.match(
    snapshot.pages.find((item) => item.path === 'attached.md').images[
      'assets/clip.webm'
    ],
    /^data:video\/webm;base64,/,
  )
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    },
    join(root, 'site.html'),
  )
  await choose('export documentation')
  await page.getByText(/exported .*pages/).waitFor()
  const nextWindow = app.waitForEvent('window')
  const exported = await app.evaluateHandle(
    async ({ BrowserWindow }, path) => {
      const window = new BrowserWindow({
        show: false,
        focusable: false,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      })
      await window.loadFile(path)
      return window
    },
    join(root, 'site.html'),
  )
  const sitePage = await nextWindow
  await sitePage.locator('article video').waitFor()
  await sitePage.waitForFunction(
    () => document.querySelector('article video')?.readyState >= 1,
  )
  await exported.evaluate((window) => window.destroy())
  await exported.dispose()
  await drop(join(workspace, 'one.md'), page.locator('.app'))
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'one.md',
  )
  assert.equal(
    await page.evaluate(async (url) => (await fetch(url)).status, url),
    404,
  )
  const tree = page.getByRole('tree', { name: 'workspace files' })
  const one = tree.getByRole('treeitem', { name: 'one.md', exact: true })
  await one.waitFor()
  await source.fill('# unsaved one')
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  await one.dispatchEvent('dragstart', { dataTransfer: transfer })
  await tree
    .getByRole('treeitem', { name: 'folder', exact: true })
    .dispatchEvent('drop', { dataTransfer: transfer })
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getWorkspace()).activePath === 'folder/one.md',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '# unsaved one',
  )
  await assert.rejects(readFile(join(workspace, 'one.md')), { code: 'ENOENT' })
  assert.equal(
    await readFile(join(workspace, 'folder/one.md'), 'utf8'),
    '# one',
  )
  await tree
    .getByRole('treeitem', { name: 'one.md', exact: true })
    .dispatchEvent('dragstart', { dataTransfer: transfer })
  await page
    .locator('.workspace-sidebar .sidebar-scroll')
    .dispatchEvent('drop', { dataTransfer: transfer })
  await waitForAsync(
    page,
    async () => (await window.hibi.getWorkspace()).activePath === 'one.md',
  )
  await transfer.dispose()
  // A forged browser File has no disk path, and non-media bytes never get copied.
  await assert.rejects(
    page.evaluate(async () =>
      window.hibi.attachMedia(
        [new File(['secret'], 'fake.png')],
        (await window.hibi.getDocument()).revision,
      ),
    ),
  )
  const fake = join(root, 'fake.png')
  await writeFile(fake, 'not an image')
  await drop(fake, source)
  await page.getByText(/choose a supported image, gif, or video\./).waitFor()
  const guarded = join(root, 'guarded')
  const outside = join(root, 'outside')
  await mkdir(guarded)
  await mkdir(outside)
  await writeFile(join(guarded, 'note.md'), 'guarded')
  await symlink(outside, join(guarded, 'assets'), 'junction')
  await drop(join(guarded, 'note.md'), page.locator('.app'))
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'note.md',
  )
  await page.waitForFunction(
    () => document.querySelector('.app').getAttribute('aria-busy') === 'false',
  )
  await drop(gif, source)
  await page
    .getByText(/the assets folder must be beside this note, without symlinks\./)
    .waitFor()
  assert.deepEqual(await readdir(outside), [])
  // Save cancellation does not create attachments or alter the draft.
  await choose('new document')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'untitled.md',
  )
  await source.fill('keep me')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown === 'keep me',
  )
  await app.evaluate(({ dialog }, gif) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [gif] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  }, gif)
  await choose('image')
  await page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('aria-busy') === 'false',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'keep me',
  )
})
