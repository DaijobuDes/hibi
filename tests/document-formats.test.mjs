import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'

test('plain text stays literal and disabled addons stay out of formats', {
  timeout: 30000,
}, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'hibi-formats-'))
  const file = join(temp, 'literal.txt')
  await writeFile(file, '# plain **text**\n$x^2$')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(temp, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(temp, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(5000)
  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .waitFor()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await pressShortcut(app, `${mod}+o`)
  const source = page.getByRole('textbox', {
    name: 'Plain text editor',
    exact: true,
  })
  await source.waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: /^normal$/i, exact: true })
      .isDisabled(),
    true,
  )
  assert.equal(
    await page
      .getByRole('button', { name: /^side-by-side$/i, exact: true })
      .isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: /^bold$/i, exact: true }).count(),
    0,
  )
  await pressShortcut(app, `${mod}+Shift+[`)
  assert.equal(await source.isVisible(), true)
  assert.equal(await source.textContent(), '# plain **text**$x^2$')
  assert.equal(
    await page.locator('.source-pane .hibi-token-heading').count(),
    0,
  )
  await pressShortcut(app, `${mod}+,`)
  await page.getByRole('tab', { name: 'Formats', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Plain text default application',
        exact: true,
      })
      .isDisabled(),
    true,
  )
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Markdown default application',
        exact: true,
      })
      .isDisabled(),
    true,
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Typst default application', exact: true })
      .count(),
    0,
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Typst settings', exact: true })
      .count(),
    0,
  )
  assert.equal(
    await page.getByRole('tab', { name: 'Typst', exact: true }).count(),
    0,
  )
  await page.getByRole('searchbox', { name: 'Filter formats' }).fill('.md')
  await page
    .getByRole('button', { name: 'Markdown settings', exact: true })
    .click()
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Enable format', exact: true })
      .count(),
    0,
  )
  assert.equal(
    await page
      .locator('#settings-plugin-markdown .setting-availability')
      .textContent(),
    'Always available',
  )
  const states = await page.evaluate(() =>
    window.hibi.setAddonEnabled('markdown', false),
  )
  assert.equal(states.find((state) => state.id === 'markdown').enabled, true)
})
