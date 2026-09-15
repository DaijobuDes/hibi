import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'
import { parseFrontmatter } from '../src/addons/frontmatter/markdown.ts'

test('frontmatter preserves raw metadata, spacing, and delimiter boundaries', () => {
  const prefix =
    '\uFEFF---  \r\ntitle: keep me\r\ntags: [one, two]\r\n...\r\n\r\n'
  const projection = parseFrontmatter(`${prefix}original body`)
  assert.equal(projection.content, 'original body')
  assert.equal(projection.serialize('edited body'), `${prefix}edited body`)
  assert.equal(
    parseFrontmatter('---\ntitle: note\n---').serialize('body'),
    '---\ntitle: note\n---\nbody',
  )
  assert.equal(
    parseFrontmatter('---\ntitle: note\n---').serialize(''),
    '---\ntitle: note\n---',
  )
  assert.equal(parseFrontmatter('paragraph\n---\ntitle: note\n---'), null)
  assert.equal(parseFrontmatter('---\nnot closed'), null)
})

test('frontmatter addon, inline rename, and centered workspace entry preserve documents', {
  timeout: 45000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-frontmatter-'))
  const prefix = '\uFEFF---\r\ntitle: keep me\r\n---\r\n\r\n'
  const original = `${prefix}original body`
  const fixture = join(folder, 'metadata.md')
  await writeFile(fixture, original)
  await writeFile(join(folder, 'occupied.md'), 'do not replace')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(folder, { recursive: true, force: true })
  })
  await app.evaluate(
    ({ dialog }, data) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [data.fixture],
      })
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.suggestedName = options.defaultPath
        return { canceled: false, filePath: `${data.folder}/meeting notes.md` }
      }
    },
    { fixture, folder },
  )
  const page = await app.firstWindow()
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  const center = await page.locator('.open-workspace').evaluate((button) => {
    const area = button.closest('.sidebar-scroll').getBoundingClientRect()
    const bounds = button.getBoundingClientRect()
    const icon = button.querySelector('svg').getBoundingClientRect()
    const text = button.querySelector('span').getBoundingClientRect()
    return {
      x: Math.abs(bounds.x + bounds.width / 2 - area.x - area.width / 2),
      y: Math.abs(bounds.y + bounds.height / 2 - area.y - area.height / 2),
      iconAbove: icon.bottom < text.top,
    }
  })
  assert.ok(center.x < 1 && center.y < 1 && center.iconAbove)
  const rename = async (name) => {
    await page.getByRole('button', { name: 'rename document' }).click()
    const input = page.getByRole('textbox', { name: 'file name' })
    await input.fill(name)
    await input.press('Enter')
  }
  await rename('meeting notes')
  await page
    .getByRole('button', { name: 'rename document' })
    .filter({ hasText: 'meeting notes.md' })
    .waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.match(
    await page
      .getByRole('button', { name: 'command palette', exact: true })
      .innerText(),
    /k/,
  )
  await page.getByRole('button', { name: 'save', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label=save]').disabled,
  )
  assert.match(
    await app.evaluate(() => globalThis.suggestedName),
    /meeting notes\.md$/,
  )
  await page.getByRole('button', { name: 'open', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.tiptap')?.getAttribute('contenteditable') ===
        'true' &&
      document.querySelector('.tiptap')?.textContent === 'original body',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    original,
  )
  assert.equal(await page.locator('.source-notice').count(), 0)
  await rich.fill('updated body')
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    `${prefix}updated body`,
  )
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.fill('---\ntitle: changed\n---\n\nsource body')
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  await rich.fill('visual body')
  const edited = (await page.evaluate(() => window.hibi.getDocument())).markdown
  assert.equal(edited, '---\ntitle: changed\n---\n\nvisual body')
  for (const enabled of [false, true]) {
    await page.getByRole('button', { name: 'editor settings' }).click()
    await page.getByRole('tab', { name: 'addons', exact: true }).click()
    await page
      .getByRole('checkbox', { name: 'frontmatter', exact: true })
      .click()
    await page.waitForFunction(
      (editable) =>
        document.querySelector('.tiptap').getAttribute('contenteditable') ===
        String(editable),
      enabled,
    )
    await page.getByRole('button', { name: 'back to editor' }).click()
    assert.equal(
      (await page.evaluate(() => window.hibi.getDocument())).markdown,
      edited,
    )
  }
  await rename('renamed.md')
  await page
    .getByRole('button', { name: 'rename document' })
    .filter({ hasText: 'renamed.md' })
    .waitFor()
  await assert.rejects(readFile(fixture), { code: 'ENOENT' })
  assert.equal(await readFile(join(folder, 'renamed.md'), 'utf8'), original)
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    edited,
  )
  await page.getByRole('button', { name: 'save', exact: true }).click()
  await page
    .getByRole('status', { name: 'unsaved changes' })
    .waitFor({ state: 'hidden' })
  assert.equal(await readFile(join(folder, 'renamed.md'), 'utf8'), edited)
  await rename('occupied.md')
  await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor()
  assert.equal(
    await readFile(join(folder, 'occupied.md'), 'utf8'),
    'do not replace',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).name,
    'renamed.md',
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.renameDocument('../escape.md')),
    /file name/,
  )
  await rename('final.md')
  await page
    .getByRole('button', { name: 'rename document' })
    .filter({ hasText: 'final.md' })
    .waitFor()
  await page.locator('.error-message').waitFor({ state: 'hidden' })
})
