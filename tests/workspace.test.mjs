import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'
import { pressShortcut } from './keyboard.mjs'

test('nested workspace editing, addon lifecycle, and offline static export', {
  timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hibi-workspace-'))
  const folder = join(directory, 'docs')
  const output = join(directory, 'index.html')
  await mkdir(join(folder, 'guides', 'advanced'), { recursive: true })
  await writeFile(
    join(folder, 'README.md'),
    '# welcome\n\n[nested guide](guides/advanced/setup.md#installation)\n\n<script>window.compromised = true</script>\n\n<img src="https://example.com/tracker" onerror="window.compromised=true">\n\n[bad](javascript:alert(1))\n\nreplace tokens: $& $$',
  )
  await writeFile(
    join(folder, 'guides', 'advanced', 'setup.md'),
    '# installation\n\nconfigure quantumwidgets here.',
  )
  await writeFile(join(directory, 'outside.md'), 'outside-secret')
  await symlink(join(directory, 'outside.md'), join(folder, 'linked.md'))
  await symlink(directory, join(folder, 'escape'))
  await writeFile(join(folder, '.secret.md'), 'hidden-secret')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(directory, 'profile')}`],
    colorScheme: null,
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })
  await app.evaluate(
    ({ dialog }, data) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [data.folder],
      })
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: data.output,
      })
    },
    { folder, output },
  )
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page
    .getByRole('button', { name: 'open workspace', exact: true })
    .click()
  await page.getByRole('treeitem', { name: 'guides', exact: true }).click()
  await page.getByRole('treeitem', { name: 'advanced', exact: true }).click()
  await page.getByRole('treeitem', { name: 'setup.md', exact: true }).click()
  await page
    .getByRole('heading', { name: 'installation', exact: true })
    .waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getWorkspace())).activePath,
    'guides/advanced/setup.md',
  )
  assert.equal(
    await page
      .getByRole('treeitem', { name: 'linked.md', exact: true })
      .count(),
    0,
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.openWorkspaceFile('../outside.md')),
    /invalid workspace/,
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.openWorkspaceFile('linked.md')),
    /symlink/,
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.openWorkspaceFile('escape/outside.md')),
    /outside/,
  )
  await page
    .getByRole('textbox', { name: 'document editor' })
    .fill('unsaved workspace draft')
  const draft = (await page.evaluate(() => window.hibi.getDocument())).markdown
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 2,
      checkboxChecked: false,
    })
  })
  await page.getByRole('treeitem', { name: 'README.md', exact: true }).click()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    draft,
  )
  await page.getByRole('button', { name: 'save', exact: true }).click()
  await page.waitForFunction(() =>
    window.hibi.getDocument().then((doc) => !doc.dirty),
  )
  assert.equal(
    await readFile(join(folder, 'guides', 'advanced', 'setup.md'), 'utf8'),
    draft,
  )
  await writeFile(
    join(folder, 'guides', 'advanced', 'setup.md'),
    '# installation\n\nconfigure quantumwidgets here.',
  )
  await page.getByRole('treeitem', { name: 'README.md', exact: true }).click()
  await page.getByRole('heading', { name: 'welcome', exact: true }).waitFor()

  await page
    .getByRole('button', { name: 'editor settings', exact: true })
    .click()
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  const enabled = page.getByRole('checkbox', {
    name: 'documentation',
    exact: true,
  })
  await enabled.click()
  await page.waitForFunction(
    () => !document.querySelector('#settings-addons input').checked,
  )
  await page.waitForFunction(() =>
    window.hibi
      .getAddonStates()
      .then((states) =>
        states.some((addon) => addon.id === 'documentation' && !addon.enabled),
      ),
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.invokeAddon('documentation', 'export')),
    /not enabled/,
  )
  await enabled.click()
  await page.waitForFunction(
    () => document.querySelector('#settings-addons input').checked,
  )
  await page.waitForFunction(() =>
    window.hibi
      .getAddonStates()
      .then((states) =>
        states.some((addon) => addon.id === 'documentation' && addon.enabled),
      ),
  )
  await assert.rejects(
    page.evaluate(() =>
      window.hibi.invokeAddon('documentation', 'constructor'),
    ),
    /unknown addon method/,
  )
  await page
    .getByRole('button', { name: 'back to editor', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'export documentation', exact: true })
    .click()
  await page
    .getByRole('status')
    .filter({ hasText: 'exported 2 pages' })
    .waitFor()
  const html = await readFile(output, 'utf8')
  assert.ok(!html.includes('outside-secret') && !html.includes('hidden-secret'))
  assert.ok(
    html.includes('data:font/woff2;base64,') ||
      html.includes('data:application/font-woff;base64,') ||
      html.includes('data:font/woff;base64,'),
  )

  const nextWindow = app.waitForEvent('window')
  const viewerId = await app.evaluate(({ BrowserWindow }, output) => {
    const viewer = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    void viewer.loadFile(output)
    return viewer.id
  }, output)
  const site = await nextWindow
  const siteErrors = []
  site.on('pageerror', (error) => siteErrors.push(error.message))
  await site.getByRole('heading', { name: 'welcome', exact: true }).waitFor()
  await site.getByText('replace tokens: $& $$', { exact: true }).waitFor()
  assert.equal(await site.evaluate(() => typeof window.hibi), 'undefined')
  assert.equal(await site.locator('[contenteditable="true"]').count(), 0)
  assert.equal(await site.locator('.view-switch').count(), 0)
  assert.equal(await site.evaluate(() => window.compromised), undefined)
  assert.equal(await site.locator('article img').getAttribute('src'), null)
  assert.equal(
    await site.getByText('bad', { exact: true }).getAttribute('href'),
    null,
  )
  await site.context().setOffline(true)
  await site.getByRole('link', { name: 'nested guide', exact: true }).click()
  await site
    .getByRole('heading', { name: 'installation', exact: true })
    .waitFor()
  assert.match(site.url(), /page=guides%2Fadvanced%2Fsetup.md/)
  await site.keyboard.press(
    process.platform === 'darwin' ? 'Meta+k' : 'Control+k',
  )
  const search = site.getByRole('combobox', { name: 'search commands' })
  await search.fill('instalation')
  await site.getByRole('option').filter({ hasText: 'installation' }).waitFor()
  await search.fill('quantumwidgets')
  await site.getByRole('option').filter({ hasText: 'installation' }).waitFor()
  await search.press('Enter')
  await site.getByRole('dialog').waitFor({ state: 'hidden' })
  await mkdir('test-results', { recursive: true })
  await site.screenshot({ path: 'test-results/exported-documentation.png' })
  await site.context().setOffline(false)
  assert.deepEqual(siteErrors, [])
  assert.deepEqual(errors, [])
  await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(),
    viewerId,
  )
  await pressShortcut(
    app,
    process.platform === 'darwin' ? 'Meta+k' : 'Control+k',
  )
  await page.getByRole('dialog', { name: 'command palette' }).waitFor()
})
