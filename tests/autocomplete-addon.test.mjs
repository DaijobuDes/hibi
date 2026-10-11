import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('autocomplete learns locally, disables learning, excludes documents and clears disk through settings and palette', {
  timeout: 90000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-autocomplete-'))
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ dictionary: true, autocomplete: true }),
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await waitForDocumentEditor(app, page)
  await app.evaluate(({ ipcMain }) => {
    globalThis.autocompleteNetwork = []
    globalThis.fetch = async (input) => {
      globalThis.autocompleteNetwork.push(String(input))
      throw new Error('autocomplete must stay offline')
    }
    ipcMain.removeHandler('host-network:get-text')
    ipcMain.handle('host-network:get-text', (_event, _owner, request) => {
      globalThis.autocompleteNetwork.push(request.url)
      throw new Error('autocomplete must stay offline')
    })
  })
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  const settings = async () => {
    await clickMenu(app, 'Settings')
    await page.getByRole('tab', { name: 'Autocomplete', exact: true }).click()
  }
  const back = async () => {
    await page.getByRole('button', { name: /back to app/i }).click()
    await page.locator('.settings-screen').waitFor({ state: 'hidden' })
    await waitForDocumentEditor(app, page)
    await rich.evaluate((element) => element.editor.commands.focus('end'))
  }
  const stored = () =>
    page.evaluate(() =>
      window.hibi.readAddonStorage({
        owner: 'autocomplete',
        scope: { kind: 'global' },
        key: 'learned-words',
        version: 1,
      }),
    )
  const disk = async () =>
    JSON.parse(
      await readFile(
        join(profile, 'addon-storage', 'global', 'autocomplete.json'),
        'utf8',
      ),
    )
  await settings()
  await page
    .getByText('Enable Dictionary and thesaurus to use autocomplete.', {
      exact: false,
    })
    .waitFor({ state: 'hidden' })
  await back()
  await page.keyboard.type(
    'bro that was wild. bro that was wild. bro that was wild. ',
  )
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return (
      data.status === 'ready' &&
      // Counts begin decaying before the debounced write reaches disk.
      data.value.entries.some((row) => row.word === 'wild' && row.count > 2.99)
    )
  })
  const first = await stored()
  assert.ok(
    first.value.entries.every(
      (row) => row.scope === null && row.context.length <= 2,
    ),
  )
  assert.ok(
    first.value.entries.some(
      (row) => row.word === 'wild' && row.context.join(' ') === 'that was',
    ),
  )
  await page.keyboard.type('bro that was ')
  const popup = page.getByRole('listbox', { name: 'Completions' })
  await popup.getByRole('option', { name: 'wild', exact: true }).waitFor()
  await page.keyboard.press('Tab')
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.endsWith('bro that was wild'),
  )

  await settings()
  await page.locator('#autocomplete-learning').uncheck()
  await back()
  const beforeDisabled = await stored()
  await page.keyboard.type(' disabledword ')
  assert.deepEqual((await stored()).value, beforeDisabled.value)
  await settings()
  await page.locator('#autocomplete-learning').check()
  await page.locator('#autocomplete-exclude-document').check()
  await back()
  await page.keyboard.type(' excludedword ')
  assert.equal(
    (await stored()).value.entries.some((row) => row.word === 'excludedword'),
    false,
  )

  await settings()
  const clearButton = page
    .getByRole('main', { name: 'Settings' })
    .getByRole('button', { name: 'Clear learned words', exact: true })
  await clearButton.click()
  const confirmation = page.getByRole('dialog', { name: 'Clear learned words' })
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await confirmation.waitFor({ state: 'hidden' })
  assert.ok((await stored()).value.entries.length > 0)
  await clearButton.click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await page.getByText('Learned words cleared.', { exact: true }).waitFor()
  assert.deepEqual((await disk()).entries['learned-words'].value.entries, [])
  await page.locator('#autocomplete-exclude-document').uncheck()
  await back()
  await page.keyboard.type('freshword ')
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return (
      data.status === 'ready' &&
      data.value.entries.some((row) => row.word === 'freshword')
    )
  })
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Autocomplete: clear learned words')
  await page
    .getByRole('option', { name: /Autocomplete: clear learned words/i })
    .click()
  await page
    .getByRole('dialog', { name: 'Clear learned words' })
    .getByRole('button', { name: 'All workspaces', exact: true })
    .click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return data.status === 'ready' && data.value.entries.length === 0
  })
  assert.deepEqual((await disk()).entries['learned-words'].value.entries, [])
  await confirmation.waitFor({ state: 'hidden' })
  const learnWord = async (word) => {
    await rich.evaluate((element) => element.editor.commands.focus('end'))
    await page.keyboard.type(` ${word} `)
    await waitForAsync(
      page,
      async (word) => {
        const data = await window.hibi.readAddonStorage({
          owner: 'autocomplete',
          scope: { kind: 'global' },
          key: 'learned-words',
          version: 1,
        })
        return (
          data.status === 'ready' &&
          data.value.entries.some((row) => row.word === word)
        )
      },
      word,
    )
  }
  await learnWord('outsideword')
  const workspace = join(profile, 'workspace-fixture')
  await mkdir(workspace)
  await writeFile(join(workspace, 'note.md'), 'existing ')
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [workspace],
    })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, workspace)
  await page.getByRole('button', { name: /toggle workspace sidebar/i }).click()
  await page
    .getByRole('button', { name: /^open workspace$/i, exact: true })
    .click()
  await page.getByRole('treeitem', { name: /^note\.md$/i, exact: true }).click()
  await waitForDocumentEditor(app, page)
  await learnWord('workspaceword')
  const workspaceId = await page.evaluate(
    async () => (await window.hibi.getWorkspace()).id,
  )
  const scoped = (await stored()).value.entries
  assert.ok(
    scoped.some((row) => row.word === 'outsideword' && row.scope === null),
  )
  assert.ok(
    scoped.some(
      (row) => row.word === 'workspaceword' && row.scope === workspaceId,
    ),
  )
  await settings()
  await page.locator('#autocomplete-clear-scope').selectOption('workspace')
  await clearButton.click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await confirmation.waitFor({ state: 'hidden' })
  const remaining = (await disk()).entries['learned-words'].value.entries
  assert.ok(remaining.some((row) => row.word === 'outsideword'))
  assert.ok(remaining.every((row) => row.scope !== workspaceId))
  assert.deepEqual(await app.evaluate(() => globalThis.autocompleteNetwork), [])
  assert.deepEqual(errors, [])
})
