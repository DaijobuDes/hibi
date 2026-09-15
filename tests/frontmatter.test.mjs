import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'
import { parseDocument } from 'yaml'
import {
  parseFrontmatter,
  replaceFrontmatter,
  splitFrontmatter,
} from '../src/addons/frontmatter/markdown.ts'

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
  for (const source of [
    '---',
    '---\n',
    '---\n\n',
    '---\n---\n',
    '---\nparagraph\n---\nbody',
    '---\ntitle: not closed',
  ])
    assert.equal(parseFrontmatter(source), null)
  assert.ok(parseFrontmatter('---\n{}\n---\n'))
  assert.equal(
    replaceFrontmatter(`${prefix}original body`, 'title: changed\n'),
    '\uFEFF---  \r\ntitle: changed\r\n...\r\n\r\noriginal body',
  )
})

test('frontmatter fields preserve comments, types, nested YAML and body edits', {
  timeout: 45000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-properties-'))
  const fixture = join(folder, 'properties.md')
  const metadata =
    'title: original # keep this comment\npublic: false\norder: 2\nbig: 999999999999999999999\noptions:\n  theme: &theme dark\nalias: *theme\ntags: [one, two]\n'
  const original = `\uFEFF---\r\n${metadata.replaceAll('\n', '\r\n')}...\r\n\r\nbody stays here\r\n`
  await writeFile(fixture, original)
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
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [fixture],
    })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, fixture)
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  assert.equal(
    await page.getByRole('region', { name: 'frontmatter properties' }).count(),
    0,
  )
  await page.getByRole('button', { name: 'open', exact: true }).click()
  const properties = page.getByRole('region', {
    name: 'frontmatter properties',
  })
  await properties
    .getByRole('textbox', { name: 'title', exact: true })
    .fill('changed: title # literal')
  await properties
    .getByRole('checkbox', { name: 'public', exact: true })
    .check()
  await properties
    .getByRole('spinbutton', { name: 'order', exact: true })
    .fill('8')
  const read = async () =>
    (await page.evaluate(() => window.hibi.getDocument())).markdown
  let source = await read()
  const block = splitFrontmatter(source)
  let values = parseDocument(block.yaml, { intAsBigInt: true }).toJS()
  assert.equal(block.content, 'body stays here\r\n')
  assert.equal(values.title, 'changed: title # literal')
  assert.equal(values.public, true)
  assert.equal(values.order, 8n)
  const number = properties.getByRole('spinbutton', {
    name: 'order',
    exact: true,
  })
  await number.fill('')
  await number.pressSequentially('-3.5')
  assert.equal(
    parseDocument(splitFrontmatter(await read()).yaml).toJS().order,
    -3.5,
  )
  assert.equal(values.big, 999999999999999999999n)
  assert.equal(values.alias, 'dark')
  assert.deepEqual(values.tags, ['one', 'two'])
  assert.match(block.yaml, /# keep this comment/)
  assert.match(source, /^\uFEFF---\r\n/)
  assert.ok(source.endsWith('...\r\n\r\nbody stays here\r\n'))
  await properties
    .getByRole('button', { name: 'add property', exact: true })
    .click()
  await properties
    .getByRole('textbox', { name: 'new property name' })
    .fill('draft')
  await properties
    .getByRole('combobox', { name: 'new property type' })
    .selectOption('boolean')
  await properties
    .getByRole('button', { name: 'add property', exact: true })
    .click()
  await properties.getByRole('checkbox', { name: 'draft', exact: true }).check()
  await properties
    .getByRole('button', { name: 'remove order', exact: true })
    .click()
  source = await read()
  await properties.getByRole('button', { name: 'yaml', exact: true }).click()
  const yaml = properties.getByRole('textbox', { name: 'frontmatter yaml' })
  await yaml.fill('tags: [broken')
  await properties
    .getByRole('button', { name: 'apply yaml', exact: true })
    .click()
  await properties.getByRole('alert').waitFor()
  assert.equal(await read(), source)
  await yaml.fill(
    splitFrontmatter(source).yaml.replace(
      'theme: &theme dark',
      'theme: &theme light',
    ),
  )
  await properties
    .getByRole('button', { name: 'apply yaml', exact: true })
    .click()
  values = parseDocument(splitFrontmatter(await read()).yaml, {
    intAsBigInt: true,
  }).toJS()
  assert.equal(values.options.theme, 'light')
  assert.equal(values.alias, 'light')
  assert.equal(values.draft, true)
  assert.equal(values.order, undefined)
  await page
    .getByRole('textbox', { name: 'document editor' })
    .fill('updated body')
  assert.equal(splitFrontmatter(await read()).content, 'updated body')
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('.source-pane .cm-content')
      ?.textContent.includes('draft: true'),
  )
  const heights = await properties
    .getByRole('button', { name: /^properties/ })
    .evaluate(async (button) => {
      const body = document.querySelector('.frontmatter-disclosure')
      const result = [body.getBoundingClientRect().height]
      button.click()
      const start = performance.now()
      while (performance.now() - start < 210) {
        await new Promise(requestAnimationFrame)
        result.push(body.getBoundingClientRect().height)
      }
      return result
    })
  assert.ok(heights.some((height) => height > 0 && height < heights[0]))
  assert.equal(heights.at(-1), 0)
  await page.getByRole('button', { name: 'save', exact: true }).click()
  await page
    .getByRole('status', { name: 'unsaved changes' })
    .waitFor({ state: 'hidden' })
  assert.equal(await readFile(fixture, 'utf8'), await read())
  await page.getByRole('button', { name: 'new', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.tiptap')?.textContent === '',
  )
  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  await page
    .getByRole('combobox', { name: 'search commands' })
    .fill('add frontmatter')
  await page.getByRole('option').filter({ hasText: 'add frontmatter' }).click()
  await properties.waitFor()
  assert.equal(await read(), '---\n{}\n---\n\n')
})

test('typing a leading divider never activates frontmatter or disables editing', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-divider-'))
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
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  await rich.pressSequentially('---')
  await rich.press('Enter')
  await rich.pressSequentially('keep writing')
  assert.equal(await rich.getAttribute('contenteditable'), 'true')
  assert.ok(
    (await page.evaluate(() => window.hibi.getDocument())).markdown.includes(
      'keep writing',
    ),
  )
  assert.equal(await page.locator('.frontmatter').count(), 0)
  for (const source of [
    '---\n\n---\n\nbody',
    '---\nplain paragraph\n---\n\nbody',
    '---\ntitle: still typing',
  ]) {
    await page
      .getByRole('button', { name: 'markdown only', exact: true })
      .click()
    await page.getByRole('textbox', { name: 'markdown editor' }).fill(source)
    await page.getByRole('button', { name: 'normal', exact: true }).click()
    assert.equal(await rich.getAttribute('contenteditable'), 'true')
    assert.equal(await page.locator('.frontmatter').count(), 0)
    assert.equal(
      (await page.evaluate(() => window.hibi.getDocument())).markdown,
      source,
    )
  }
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
