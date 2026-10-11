import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { packs } from '../src/addons/dictionary/packs.ts'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { waitForAsync } from './poll.mjs'

async function launch(profile, bytes) {
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  try {
    await app.evaluate(
      (_electron, { url, bytes }) => {
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

test('native pack install, offline lookup, profile restart, path rejection and uninstall', async (t) => {
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
  await page.evaluate(() =>
    window.hibi.invokeAddon('dictionary', 'installPack', 'zh'),
  )
  await waitForPack(page, 'installed')
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
  await app.close()
  app = undefined
  launched = await launch(profile)
  app = launched.app
  page = launched.page
  await waitForPack(page, 'installed')
  assert.deepEqual(await lookup(page), entries)
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
