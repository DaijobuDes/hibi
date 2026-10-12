import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { APP_STATE_TIMEOUT, waitForAsync } from './poll.mjs'

test('custom words are added, edited, removed, kept across restart, and suggested without going online', {
  timeout: 120000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-dictionary-custom-'))
  const file = join(profile, 'note.md')
  await writeFile(file, 'The zorp is kilig')
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ dictionary: true, autocomplete: true }),
  )
  let app
  t.after(async () => {
    await app?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app?.close()
    await rm(profile, { recursive: true, force: true })
  })
  const launch = async () => {
    app = await electron.launch({
      args: [resolve('.'), `--user-data-dir=${profile}`],
    })
    await app.evaluate(({ dialog }, path) => {
      dialog.showMessageBox = async () => ({ response: 1 })
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      globalThis.fetch = async (input) => {
        throw new Error(`network forbidden: ${input}`)
      }
    }, file)
    const page = await app.firstWindow()
    page.setDefaultTimeout(APP_STATE_TIMEOUT)
    await waitForDocumentEditor(app, page)
    await app.evaluate(({ ipcMain }) => {
      globalThis.onlineRequests = []
      ipcMain.removeHandler('host-network:get-text')
      ipcMain.handle('host-network:get-text', (_event, _owner, request) => {
        globalThis.onlineRequests.push(request.url)
        throw new Error('online dictionary network forbidden')
      })
    })
    return page
  }
  let page = await launch()
  const online = () => app.evaluate(() => globalThis.onlineRequests)
  const openSettings = async () => {
    await clickMenu(app, 'Settings')
    await page
      .getByRole('tab', { name: 'Dictionary and thesaurus', exact: true })
      .click()
    return page.getByRole('region', { name: 'Custom words' })
  }
  const closeSettings = async () => {
    await page.getByRole('button', { name: /back to app/i }).click()
    await page.locator('.settings-screen').waitFor({ state: 'hidden' })
    await waitForDocumentEditor(app, page)
  }

  await clickMenu(app, 'Open…')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'note.md',
  )
  await waitForDocumentEditor(app, page)
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  await rich.click()
  await rich.evaluate((element) => element.editor.commands.setTextSelection(6))

  // A word with no entry is added from the side view and then shown as yours.
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Open dictionary side view')
  await page.getByRole('option', { name: /Open dictionary side view/ }).click()
  const side = page.getByRole('complementary', { name: 'Dictionary' })
  await side.getByRole('heading', { name: 'zorp', exact: true }).waitFor()
  await side.getByRole('button', { name: 'Add to dictionary' }).click()
  await side.getByText('Added to your dictionary.').waitFor()
  await side.getByText('Your word', { exact: true }).waitFor()

  // Settings: add, give a language and a note, and remove.
  let words = await openSettings()
  await words.getByRole('listitem').filter({ hasText: 'zorp' }).waitFor()
  await words.getByRole('textbox', { name: 'New custom word' }).fill('kilig')
  await words.getByRole('button', { name: 'Add', exact: true }).click()
  await words
    .getByRole('combobox', { name: 'Language of “kilig”' })
    .selectOption('tl')
  const note = words.getByRole('textbox', { name: 'Note for “zorp”' })
  await note.fill('a made-up word')
  await note.press('Tab')
  await words.getByRole('textbox', { name: 'New custom word' }).fill('Hibiland')
  await words.getByRole('button', { name: 'Add', exact: true }).click()
  await words.getByRole('button', { name: 'Remove “kilig”' }).click()
  await words.getByRole('button', { name: 'Remove “kilig”' }).waitFor({
    state: 'detached',
  })
  await page.screenshot({ path: 'test-results/dictionary-custom-words.png' })
  await closeSettings()

  // Suggestions put custom words first and never go online.
  await rich.evaluate((element) => element.editor.commands.focus('end'))
  await page.keyboard.type(' Hib')
  const menu = page.getByRole('listbox', { name: 'Completions' })
  await menu
    .getByRole('option', { name: /^Hibiland/ })
    .filter({ hasText: 'Your word' })
    .waitFor()
  await page.keyboard.press('ArrowDown')
  await menu.getByRole('option', { selected: true }).waitFor()
  await page.keyboard.press('Enter')
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.endsWith(' Hibiland'),
  )
  assert.deepEqual(await online(), [])

  // Words, notes, and languages survive a restart.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 })
  })
  await app.close()
  app = undefined
  page = await launch()
  words = await openSettings()
  await words.getByRole('listitem').filter({ hasText: 'Hibiland' }).waitFor()
  assert.equal(
    await words.getByRole('textbox', { name: 'Note for “zorp”' }).inputValue(),
    'a made-up word',
  )
  assert.equal(
    await words.getByRole('button', { name: 'Remove “kilig”' }).count(),
    0,
  )
  // Export copies plain text that import accepts.
  await words.getByRole('button', { name: 'Export as text' }).click()
  assert.equal(
    await words
      .getByRole('textbox', { name: 'Custom words as text' })
      .inputValue(),
    'zorp\t\ta made-up word\nHibiland',
  )
  await words
    .getByRole('textbox', { name: 'Custom words as text' })
    .fill('kilig\ttl\tgiddy')
  await words.getByRole('button', { name: 'Import text' }).click()
  await words.getByText('Imported 1 word.').waitFor()
  assert.equal(
    await words
      .getByRole('combobox', { name: 'Language of “kilig”' })
      .inputValue(),
    'tl',
  )
  assert.deepEqual(await online(), [])
})
