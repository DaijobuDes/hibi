import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { pressShortcut, replaceRichText } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('typing stays available and unsaved while a save finishes', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-save-editing-'))
  const file = join(profile, 'note.md')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(profile, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(7000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await waitForDocumentEditor(app, page)
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, file)
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('.app')?.getAttribute('aria-busy') === 'false',
    )
  // Main writes the file before it replies, for example while it records
  // version history. Hold that reply and type in the meantime.
  const saveWhileTyping = async (text) => {
    await app.evaluate(({ ipcMain }) => {
      const save = ipcMain._invokeHandlers.get('document:save')
      ipcMain._invokeHandlers.set('document:save', async (...args) => {
        ipcMain._invokeHandlers.set('document:save', save)
        const released = new Promise((resolve) => {
          globalThis.releaseSave = resolve
        })
        const saved = await save(...args)
        await released
        return saved
      })
    })
    const before = (await page.evaluate(() => window.hibi.getDocument()))
      .markdown
    await pressShortcut(app, `${mod}+s`)
    await waitForAsync(
      page,
      async () => !(await window.hibi.getDocument()).dirty,
    )
    await page.keyboard.type(text)
    await waitForAsync(
      page,
      async (text) => (await window.hibi.getDocument()).markdown.includes(text),
      text,
    )
    await app.evaluate(() => globalThis.releaseSave())
    await idle()
    // The renderer accepted the save reply and still shows the typed text as unsaved.
    const title = page.locator('.document-title')
    await title.getByText('note.md').waitFor()
    await title.getByRole('status', { name: /unsaved changes/i }).waitFor()
    const current = await page.evaluate(() => window.hibi.getDocument())
    assert.equal(current.dirty, true)
    assert.ok(current.markdown.includes(text))
    assert.equal(await readFile(file, 'utf8'), before)
    await pressShortcut(app, `${mod}+s`)
    await waitForAsync(
      page,
      async () => !(await window.hibi.getDocument()).dirty,
    )
    await idle()
    assert.equal(await readFile(file, 'utf8'), current.markdown)
  }

  await replaceRichText(
    page,
    page.getByRole('textbox', { name: /document editor/i }),
    'first',
  )
  await saveWhileTyping(' second')

  await pressShortcut(app, `${mod}+Shift+]`)
  const source = page.getByRole('textbox', { name: /markdown editor/i })
  await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
  await source.press('ControlOrMeta+End')
  await saveWhileTyping(' third')
})
