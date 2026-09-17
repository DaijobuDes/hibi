import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { codeHtml, codeLanguages } from '../src/renderer/src/code-languages.ts'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

test('language loading deduplicates aliases and respects disabled preferences during import', async () => {
  assert.equal(codeLanguages.resolve('rust'), null)
  const [rust, alias] = await Promise.all([
    codeLanguages.ensure('rust'),
    codeLanguages.ensure('rs'),
  ])
  assert.ok(rust)
  assert.equal(rust, alias)
  assert.equal(codeLanguages.resolve('python'), null)
  codeLanguages.setEnabled('python', false)
  await codeLanguages.settle()
  assert.equal(codeLanguages.resolve('py'), null)
  codeLanguages.setEnabled('python', true)
  assert.ok(codeLanguages.resolve('py'))
  assert.match(codeHtml('def sample(): return 1', 'py'), /hibi-token-keyword/)
})

test('blank startup leaves disabled runtimes and closed settings unloaded and source unmounted', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-startup-performance-'))
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
  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .waitFor()
  await page.evaluate(
    () => new Promise((resolve) => requestIdleCallback(resolve)),
  )
  assert.equal(
    await page.evaluate(() => document.activeElement?.matches('.tiptap')),
    true,
  )
  assert.equal(await page.locator('.cm-editor').count(), 0)
  const chunks = JSON.parse(
    await readFile('out/renderer/startup-bundle.json', 'utf8'),
  )
  const session = await page.context().newCDPSession(page)
  const files = new Set()
  session.on('Debugger.scriptParsed', ({ url }) => {
    if (url.startsWith('app://hibi/')) files.add(new URL(url).pathname.slice(1))
  })
  await session.send('Debugger.enable')
  const loadedModules = async () => {
    return chunks
      .filter((chunk) => files.has(chunk.file))
      .flatMap((chunk) => chunk.modules)
      .join('\n')
  }
  const initial = await loadedModules()
  assert.match(initial, /src\/renderer\/src\/main\.tsx/)
  assert.doesNotMatch(
    initial,
    /src\/addons\/(?:math|typst|mdx|graph|git)\/index\./,
  )
  assert.doesNotMatch(
    initial,
    /src\/renderer\/src\/(?:SettingsScreen|VersionHistory|CommandPalette)\.tsx/,
  )
  assert.doesNotMatch(
    initial,
    /@codemirror\/(?:lang-rust|lang-python|lang-java|lang-sql)\//,
  )
  await clickMenu(app, 'Settings')
  assert.match(await loadedModules(), /src\/renderer\/src\/SettingsScreen\.tsx/)
  await page.getByRole('tab', { name: 'Addons', exact: true }).click()
  assert.doesNotMatch(
    await loadedModules(),
    /src\/addons\/(?:math|typst|mdx)\/index\./,
  )
})

test('unrelated enabled format engines start after the initial document is editable', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-startup-formats-'))
  await writeFile(join(profile, 'addons.json'), JSON.stringify({ rst: true }))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.waitForFunction(
    () => performance.getEntriesByName('hibi:addon:rst').length,
  )
  const order = await page.evaluate(() => ({
    ready: performance.getEntriesByName('hibi:editing-capabilities')[0]
      ?.startTime,
    format: performance.getEntriesByName('hibi:addon:rst')[0]?.startTime,
    editable:
      document.querySelector('.tiptap')?.isContentEditable &&
      !document.querySelector('.tiptap')?.closest('[inert]'),
  }))
  assert.equal(order.editable, true)
  assert.ok(order.format >= order.ready, JSON.stringify(order))
})
