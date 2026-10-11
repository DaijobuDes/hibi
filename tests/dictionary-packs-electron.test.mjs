import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { packs } from '../src/addons/dictionary/packs.ts'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

async function launch(profile, bytes) {
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  try {
    await app.evaluate(
      ({ ipcMain }, { url, bytes }) => {
        globalThis.dictionaryOnlineRequests = []
        ipcMain.removeHandler('host-network:get-text')
        ipcMain.handle('host-network:get-text', (_event, owner, request) => {
          globalThis.dictionaryOnlineRequests.push({ owner, url: request.url })
          throw new Error('online dictionary network forbidden')
        })
        globalThis.dictionaryPackRequests = []
        globalThis.fetch = async (input) => {
          const requested = String(input)
          globalThis.dictionaryPackRequests.push(requested)
          if (!bytes || requested !== url)
            throw new Error(`network forbidden: ${requested}`)
          return new Response(new Uint8Array(bytes), {
            headers: { 'content-length': String(bytes.length) },
          })
        }
      },
      { url: packs.zh.sources[0].url, bytes: bytes ? Array.from(bytes) : null },
    )
    const page = await app.firstWindow()
    await waitForDocumentEditor(app, page)
    return { app, page }
  } catch (error) {
    await app.close()
    throw error
  }
}
async function waitForPack(page, phase) {
  await waitForAsync(
    page,
    async (phase) => {
      const states = await window.hibi.queryAddon('dictionary', 'packs')
      return states.find((state) => state.id === 'zh')?.phase === phase
    },
    phase,
  )
}
const lookup = (page) =>
  page.evaluate(() =>
    window.hibi.queryAddon('dictionary', 'packLookup', {
      id: 'zh',
      word: '猫',
    }),
  )

test('pack dialog install, offline definition, profile restart, path rejection and uninstall', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-dictionary-packs-'))
  let app
  t.after(async () => {
    await app?.close()
    await rm(profile, { recursive: true, force: true })
  })
  const bytes = gzipSync(
    await readFile(
      new URL('./fixtures/dictionary-packs/zh.txt', import.meta.url),
    ),
  )
  let launched = await launch(profile, bytes)
  app = launched.app
  let page = launched.page
  await page.evaluate(() => window.hibi.setAddonEnabled('dictionary', true))
  await waitForPack(page, 'absent')
  await clickMenu(app, 'Command palette')
  const palette = page.getByRole('dialog', { name: /^command palette$/i })
  await palette
    .getByRole('combobox', { name: /search commands/i })
    .fill('Dictionary: install offline pack')
  await palette
    .getByRole('option', { name: /Dictionary: install offline pack/i })
    .click()
  const packDialog = page.getByRole('dialog', {
    name: /offline language packs/i,
  })
  const row = packDialog.locator('[data-setting-id="dictionary-pack-zh"]')
  const installButton = row.getByRole('button', { name: /^install pack$/i })
  await waitForAsync(
    page,
    () =>
      document.querySelector('button#dictionary-pack-zh')?.disabled === false,
  )
  const description = await row.locator('.setting-description').innerText()
  assert.ok(description.includes('www.mdbg.net'))
  assert.ok(description.includes(packs.zh.sources[0].name))
  assert.ok(description.includes(packs.zh.sources[0].license))
  assert.ok(
    description.includes(
      `${(packs.zh.sources[0].bytes / 1024 / 1024).toFixed(1)} MiB`,
    ),
  )
  await mkdir('test-results', { recursive: true })
  for (const width of [1000, 600]) {
    await page.setViewportSize({ width, height: 900 })
    await waitForAsync(page, (width) => window.innerWidth === width, width)
    await page.screenshot({
      path: `test-results/dictionary-packs-${width}.png`,
      animations: 'disabled',
    })
    assert.equal(
      await packDialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      true,
    )
  }
  await installButton.click()
  await waitForPack(page, 'installed')
  await row.getByRole('button', { name: /^update$/i }).waitFor()
  await page.keyboard.press('Escape')
  await packDialog.waitFor({ state: 'detached' })
  const entries = await lookup(page)
  assert.equal(entries.length, 2)
  assert.deepEqual(
    entries.map((entry) => entry.readings),
    [['mao1'], ['mao2']],
  )
  assert.match(entries[0].meanings[0].definitions[0].definition, /^cat/)
  assert.deepEqual(
    await app.evaluate(() => globalThis.dictionaryPackRequests),
    [packs.zh.sources[0].url],
  )
  await app.evaluate(() => {
    globalThis.fetch = async () => {
      throw new Error('network forbidden')
    }
  })
  assert.deepEqual(await lookup(page), entries)
  const note = join(profile, 'offline-note.md')
  await writeFile(note, '猫')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, note)
  await clickMenu(app, 'Open…')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'offline-note.md',
  )
  await waitForDocumentEditor(app, page)
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  await rich.click()
  await rich.evaluate((element) => element.editor.commands.setTextSelection(1))
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Define word')
  await page.getByRole('option', { name: /Define word/i }).click()
  const definition = page.getByRole('dialog', { name: 'Define “猫”' })
  await definition
    .getByText(entries[0].meanings[0].definitions[0].definition, {
      exact: true,
    })
    .waitFor()
  await definition.getByRole('heading', { name: 'mao1', exact: true }).waitFor()
  await definition
    .getByText('CC-CEDICT · CC BY-SA 4.0', { exact: true })
    .first()
    .waitFor()
  assert.deepEqual(
    await app.evaluate(() => globalThis.dictionaryOnlineRequests),
    [],
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '猫',
  )
  await page.keyboard.press('Escape')
  await definition.waitFor({ state: 'detached' })
  await app.close()
  app = undefined
  launched = await launch(profile)
  app = launched.app
  page = launched.page
  await waitForPack(page, 'installed')
  assert.deepEqual(await lookup(page), entries)
  assert.deepEqual(
    await app.evaluate(() => globalThis.dictionaryOnlineRequests),
    [],
  )
  const sentinel = join(profile, 'sentinel.txt')
  await writeFile(sentinel, 'untouched')
  for (const id of ['../sentinel.txt', sentinel, 'zh/../../sentinel.txt']) {
    for (const method of ['installPack', 'uninstallPack', 'cancelPack'])
      await assert.rejects(
        page.evaluate(
          ({ id, method }) => window.hibi.invokeAddon('dictionary', method, id),
          { id, method },
        ),
      )
    await assert.rejects(
      page.evaluate(
        (id) =>
          window.hibi.queryAddon('dictionary', 'packLookup', {
            id,
            word: '猫',
          }),
        id,
      ),
    )
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'untouched')
  assert.deepEqual(await lookup(page), entries)
  assert.deepEqual(
    await app.evaluate(() => globalThis.dictionaryPackRequests),
    [],
  )
  await page.evaluate(() =>
    window.hibi.invokeAddon('dictionary', 'uninstallPack', 'zh'),
  )
  await waitForPack(page, 'absent')
  assert.deepEqual(await lookup(page), [])
  await assert.rejects(
    readFile(join(profile, 'dictionary-packs', 'zh', 'manifest.json')),
    { code: 'ENOENT' },
  )
})
