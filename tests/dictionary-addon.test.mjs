import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu, pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

const fixture = (name) =>
  readFile(new URL(`./fixtures/dictionary/${name}`, import.meta.url), 'utf8')

test('dictionary looks up the caret word and replaces it with one undo step in both editors', {
  timeout: 60000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-dictionary-'))
  const file = join(profile, 'note.md')
  await writeFile(file, 'I am Happy today')
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ dictionary: true }),
  )
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
  page.setDefaultTimeout(8000)
  await waitForDocumentEditor(app, page)
  const responses = {
    'https://api.dictionaryapi.dev/api/v2/entries/en/happy': await fixture(
      'dictionaryapi-happy.json',
    ),
    'https://api.datamuse.com/words?rel_syn=happy&max=24': await fixture(
      'datamuse-synonyms-happy.json',
    ),
    'https://api.datamuse.com/words?rel_ant=happy&max=24': await fixture(
      'datamuse-antonyms-happy.json',
    ),
  }
  // Replace the network bridge so tests never reach the live services.
  await app.evaluate(({ ipcMain }, responses) => {
    globalThis.dictionaryRequests = []
    ipcMain.removeHandler('host-network:get-text')
    ipcMain.handle('host-network:get-text', (_event, owner, request) => {
      globalThis.dictionaryRequests.push(`${owner} ${request.url}`)
      const text = responses[request.url]
      return text === undefined
        ? { ok: false, code: 'http-status', status: 404 }
        : { ok: true, value: { url: request.url, status: 200, text } }
    })
  }, responses)
  const requests = () => app.evaluate(() => globalThis.dictionaryRequests)
  const markdown = async () =>
    (await page.evaluate(() => window.hibi.getDocument())).markdown

  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
  await clickMenu(app, 'Open…')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'note.md',
  )
  await waitForDocumentEditor(app, page)
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  await rich.click()
  await rich.evaluate((element) => element.editor.commands.setTextSelection(8))
  assert.deepEqual(await requests(), [])

  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Define word')
  await page.getByRole('option', { name: /Define word/ }).click()
  const define = page.getByRole('dialog', { name: 'Define “Happy”' })
  await define.getByText('Music makes me feel happy.').waitFor()
  await define.getByRole('heading', { name: 'adjective' }).waitFor()
  assert.equal(await define.locator('ol').first().locator('li').count(), 2)
  assert.deepEqual(await requests(), [
    'dictionary https://api.dictionaryapi.dev/api/v2/entries/en/happy',
  ])
  await page.keyboard.press('Escape')
  await define.waitFor({ state: 'detached' })
  await waitForAsync(page, () =>
    document.activeElement?.classList.contains('tiptap'),
  )
  assert.equal(await markdown(), 'I am Happy today')

  await rich.press('Shift+F10')
  await page
    .getByRole('menu', { name: 'Editor actions' })
    .getByRole('menuitem', { name: /^Find synonyms/ })
    .click()
  const synonyms = page.getByRole('dialog', { name: 'Synonyms for “Happy”' })
  await synonyms
    .getByRole('region', { name: 'Antonyms' })
    .getByRole('button', { name: 'sad', exact: true })
    .waitFor()
  await synonyms.getByRole('button', { name: 'glad', exact: true }).click()
  await synonyms.waitFor({ state: 'detached' })
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'I am Glad today',
  )
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.classList.contains('tiptap'),
    ),
    true,
  )
  await page.evaluate(() =>
    document.querySelector('.tiptap').editor.commands.undo(),
  )
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'I am Happy today',
  )

  await page.getByRole('button', { name: 'Source view', exact: true }).click()
  await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
  const source = page.getByRole('textbox', {
    name: 'Markdown editor',
    exact: true,
  })
  await source.focus()
  await source.press(
    process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home',
  )
  for (let step = 0; step < 7; step++) await source.press('ArrowRight')
  await pressShortcut(app, 'Shift+F7')
  const sourceSynonyms = page.getByRole('dialog', {
    name: 'Synonyms for “Happy”',
  })
  await sourceSynonyms
    .getByRole('button', { name: 'content', exact: true })
    .click()
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'I am Content today',
  )
  assert.equal((await requests()).length, 3, 'cached words are not re-sent')
  await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'I am Happy today',
  )
})
