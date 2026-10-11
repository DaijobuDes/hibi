import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { packs } from '../src/addons/dictionary/packs.ts'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { APP_STATE_TIMEOUT, waitForAsync } from './poll.mjs'

test('side view follows the caret offline, replaces in one undo step, and pack suggestions accept with Tab', {
  timeout: 90000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-dictionary-side-'))
  const file = join(profile, 'note.md')
  await writeFile(file, 'The dog is happy')
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
  const bytes = gzipSync(
    await readFile(
      new URL('./fixtures/dictionary-packs/en.xml', import.meta.url),
    ),
  )
  // Only the pack download may use the network; lookups must never reach it.
  await app.evaluate(
    ({ dialog }, { url, bytes, path }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      globalThis.packRequests = []
      globalThis.fetch = async (input) => {
        const requested = String(input)
        globalThis.packRequests.push(requested)
        if (requested !== url)
          throw new Error(`network forbidden: ${requested}`)
        return new Response(new Uint8Array(bytes), {
          headers: { 'content-length': String(bytes.length) },
        })
      }
    },
    { url: packs.en.sources[0].url, bytes: Array.from(bytes), path: file },
  )
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
  const online = () => app.evaluate(() => globalThis.onlineRequests)
  const markdown = async () =>
    (await page.evaluate(() => window.hibi.getDocument())).markdown

  await clickMenu(app, 'Open…')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'note.md',
  )
  await waitForDocumentEditor(app, page)
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  await rich.click()
  await rich.evaluate((element) => element.editor.commands.setTextSelection(14))

  const openSide = async () => {
    await clickMenu(app, 'Command palette')
    await page
      .getByRole('combobox', { name: /search commands/i })
      .fill('Open dictionary side view')
    await page
      .getByRole('option', { name: /Open dictionary side view/ })
      .click()
  }
  await openSide()
  const side = page.getByRole('complementary', { name: 'Dictionary' })
  await side.getByRole('heading', { name: 'happy', exact: true }).waitFor()

  // An empty profile offers the English pack even though Wiktionary covers
  // English online, and the view looks up again once the pack dialog closes.
  await side
    .getByRole('button', { name: 'Install English pack' })
    .first()
    .click()
  const packDialog = page.getByRole('dialog', {
    name: 'Offline language packs',
  })
  await packDialog.getByRole('button', { name: 'Install English pack' }).click()
  await waitForAsync(page, async () => {
    const states = await window.hibi.queryAddon('dictionary', 'packs')
    return states.find((state) => state.id === 'en')?.phase === 'installed'
  })
  await page.keyboard.press('Escape')
  await packDialog.waitFor({ state: 'hidden' })
  await side
    .getByText('enjoying or showing or marked by joy or pleasure')
    .waitFor()
  await side
    .getByRole('group', { name: 'Antonyms' })
    .getByRole('button', { name: /unhappy/ })
    .waitFor()
  await side
    .getByText(/Open English WordNet · CC BY 4\.0/)
    .first()
    .waitFor()

  // The view follows the caret after it settles, from the installed pack only.
  await rich.evaluate((element) => {
    element.editor.commands.focus()
    element.editor.commands.setTextSelection(6)
  })
  await side.getByRole('heading', { name: 'dog', exact: true }).waitFor()
  const chip = side
    .getByRole('group', { name: 'Synonyms' })
    .getByRole('button', { name: 'Replace with “domestic dog”' })
  await chip.waitFor()
  await mkdir('test-results', { recursive: true })
  for (const width of [1100, 640]) {
    await page.setViewportSize({ width, height: 820 })
    await waitForAsync(page, (width) => window.innerWidth === width, width)
    if (width < 700) {
      // Narrow windows collapse sidebars until one is opened.
      await side.waitFor({ state: 'hidden' })
      await openSide()
    }
    await side.getByRole('heading', { name: 'dog', exact: true }).waitFor()
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.screenshot({
        path: `test-results/dictionary-side-${scheme}-${width}.png`,
        animations: 'disabled',
      })
    }
    assert.equal(
      await side.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      true,
    )
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 1100, height: 820 })
  assert.deepEqual(await online(), [])

  // Keyboard: arrow keys move between chips; Enter replaces once.
  await chip.focus()
  await page.keyboard.press('ArrowLeft')
  assert.match(
    await page.evaluate(() => document.activeElement?.textContent),
    /Canis familiaris|domestic dog/,
  )
  await chip.focus()
  await page.keyboard.press('Enter')
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown ===
      'The domestic dog is happy',
  )
  await page.evaluate(() =>
    document.querySelector('.tiptap').editor.commands.undo(),
  )
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'The dog is happy',
  )
  assert.deepEqual(await online(), [])

  // Searching is an explicit online lookup.
  const search = side.getByRole('searchbox', { name: 'Look up a word' })
  await search.fill('zebra')
  await search.press('Enter')
  await side.getByRole('heading', { name: 'zebra', exact: true }).waitFor()
  await side.getByRole('alert').first().waitFor()
  const searched = await online()
  assert.ok(searched.length > 0)
  assert.ok(searched.every((url) => url.includes('zebra')))
  await search.press('Escape')
  await side
    .getByRole('button', { name: 'Follow the cursor', pressed: true })
    .waitFor()
  assert.deepEqual(await app.evaluate(() => globalThis.packRequests), [
    packs.en.sources[0].url,
  ])

  // Suggestions are off until enabled in the addon's settings.
  const toggle = async (id, editor) => {
    await clickMenu(app, 'Settings')
    await page
      .getByRole('tab', { name: 'Dictionary and thesaurus', exact: true })
      .click()
    await page.locator(`#${id}`).click()
    await page.screenshot({ path: `test-results/${id}.png` })
    await page.getByRole('button', { name: /back to app/i }).click()
    await page.locator('.settings-screen').waitFor({ state: 'hidden' })
    await waitForDocumentEditor(app, page, editor)
  }
  await toggle('dictionary-suggest')
  await page.evaluate(() => {
    window.tabsReachingDocument = 0
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return
      // Counts Tabs no editor handled; then keeps focus in the editor.
      if (!event.defaultPrevented) window.tabsReachingDocument++
      event.preventDefault()
    })
  })
  const tabs = () => page.evaluate(() => window.tabsReachingDocument)
  const menu = page.getByRole('listbox', { name: 'Completions' })
  await rich.evaluate((element) => {
    element.editor.commands.focus('end')
  })
  await page.keyboard.type(' hap')
  await menu.getByRole('option', { name: 'happy', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/dictionary-suggestions.png' })
  await page.keyboard.press('Tab')
  await menu.waitFor({ state: 'hidden' })
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'The dog is happy happy',
  )
  assert.equal(await tabs(), 0)

  // Without a popup, Tab belongs to the editor.
  await page.keyboard.type(' zq')
  await page.keyboard.press('Tab')
  assert.equal(await tabs(), 1)
  assert.equal(await menu.isVisible(), false)

  // With Tab acceptance off, Tab passes through and Enter still accepts.
  await toggle('dictionary-tab-accepts')
  await rich.evaluate((element) => element.editor.commands.focus('end'))
  await page.keyboard.type(' hap')
  await menu.getByRole('option', { name: 'happy', exact: true }).waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await tabs(), 2)
  assert.match(await markdown(), / zq hap$/)
  await rich.evaluate((element) => element.editor.commands.focus('end'))
  await page.keyboard.type('p')
  await menu.getByRole('option', { name: 'happy', exact: true }).waitFor()
  await page.keyboard.press('Enter')
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.endsWith(' zq happy'),
  )

  // Source view: the same Tab preference, then Tab accepts once turned back on.
  await page.getByRole('button', { name: 'Source view', exact: true }).click()
  await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
  const source = page.getByRole('textbox', {
    name: 'Markdown editor',
    exact: true,
  })
  const options = page.locator('.cm-tooltip-autocomplete [role="option"]')
  const typeAtEnd = async (text) => {
    await source.focus()
    await source.press('ControlOrMeta+End')
    await page.keyboard.type(text)
  }
  await typeAtEnd(' hap')
  await options.filter({ hasText: /^happy$/ }).waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await tabs(), 3)
  assert.match(await markdown(), / happy hap$/)
  await toggle('dictionary-tab-accepts', { name: 'Markdown editor' })
  await typeAtEnd('p')
  await options.filter({ hasText: /^happy$/ }).waitFor()
  await page.keyboard.press('Tab')
  await waitForAsync(page, async () =>
    (await window.hibi.getDocument()).markdown.endsWith(' happy happy'),
  )
  assert.equal(await tabs(), 3)
  await page.keyboard.type(' zq')
  await page.keyboard.press('Tab')
  assert.equal(await tabs(), 4)
  assert.deepEqual(await online(), searched)
})
