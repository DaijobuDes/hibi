import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { localTarget, noteGraph } from '../src/addons/graph/model.ts'
import { noteTags } from '../src/addons/tags/syntax.ts'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('tags index prose, normalize names, and exclude code, urls, escapes, and metadata', () => {
  const source =
    '---\ntitle: "#metadata"\n---\n# heading\n\n#Work #work #work/project (#日本語) #123\n\n**#bold** and `#code`\n\n```md\n#fenced\n```\n\n[hello #label](https://example.com/#url) ![#alt](image.png) \\#escaped\n\n<div>#html</div>\n'
  assert.deepEqual(noteTags(source), ['bold', 'work', 'work/project', '日本語'])
})
test('graph resolves only existing local note links and deduplicates connections', () => {
  const pages = [
    {
      path: 'a.md',
      markdown:
        '[b](folder/b.md) [again](folder/b.md#heading) [ref][note]\n\n[note]: spaced%20note.md\n\n![image](folder/b.md) [external](https://example.com/a.md) [self](#heading) [missing](none.md)\n\n```md\n[code](orphan.md)\n```',
    },
    { path: 'folder/b.md', markdown: '[back](../a.md)' },
    { path: 'spaced note.md', markdown: '' },
    { path: 'orphan.md', markdown: '' },
  ]
  const graph = noteGraph(pages)
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.length, 2)
  assert.equal(graph.nodes.find((node) => node.id === 'a.md').degree, 2)
  const paths = new Set(pages.map((page) => page.path))
  assert.equal(localTarget('folder/b.md', '/a.md', paths), 'a.md')
  for (const link of [
    '../../a.md',
    'file:///a.md',
    '//server/a.md',
    '%00a.md',
    '%GG',
  ])
    assert.equal(localTarget('folder/b.md', link, paths), null)
})

test('tags and graph plugins browse/open notes, honor drafts, and clean up when disabled', {
  timeout: 45000,
}, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'hibi-graph-tags-')),
    root = join(temp, 'notes')
  await mkdir(root)
  await writeFile(
    join(root, 'a.md'),
    '# alpha\n\n#work and #日本語\n\n[next](b.md)',
  )
  await writeFile(
    join(root, 'b.md'),
    '# beta\n\n#work #personal\n\n[back](a.md)',
  )
  await writeFile(join(root, 'orphan.md'), '# orphan\n\n#other')
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
  page.setDefaultTimeout(6500)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const choose = async (name) => {
    await pressShortcut(app, `${mod}+k`)
    await page.getByRole('combobox', { name: 'search commands' }).fill(name)
    await page
      .getByRole('option')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
      .click()
  }
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await choose('enable tags')
  await choose('enable graph')
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, root)
  await pressShortcut(app, `${mod}+Shift+o`)
  const tree = page.getByRole('tree', { name: 'workspace files' })
  await tree.getByRole('treeitem', { name: 'a.md', exact: true }).click()
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.locator('.hibi-tag[data-tag="work"]').waitFor()
  await page
    .locator('[data-status-id="tags.tags"]')
    .filter({ hasText: 'tags · 2' })
    .waitFor()
  await rich
    .locator('.hibi-tag[data-tag="work"]')
    .click({ modifiers: ['Shift'] })
  let dialog = page.getByRole('dialog', { name: 'tags', exact: true })
  const tagRow = dialog.getByRole('button', { name: '#work 2', exact: true })
  assert.equal(await tagRow.getAttribute('data-variant'), 'row')
  const tagLayout = await tagRow.evaluate((row) => ({
    row: row.getBoundingClientRect().width,
    group: row.parentElement.getBoundingClientRect().width,
    gap:
      row.getBoundingClientRect().right -
      row.lastElementChild.getBoundingClientRect().right,
  }))
  assert.ok(Math.abs(tagLayout.row - tagLayout.group) < 1)
  assert.ok(tagLayout.gap < 12, 'tag counts align at the row end')
  await dialog.getByRole('button', { name: 'b.md', exact: true }).click()
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'b.md',
  )
  await pressShortcut(app, `${mod}+Shift+]`)
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.locator('.hibi-tag[data-tag="personal"]').waitFor()
  await source.fill('# beta\n\n#personal #newtag\n\n[back](a.md)')
  await page
    .locator('[data-status-id="tags.tags"]')
    .filter({ hasText: 'tags · 2' })
    .waitFor()
  await choose('browse tags')
  dialog = page.getByRole('dialog', { name: 'tags', exact: true })
  await dialog.getByRole('button', { name: '#newtag 1', exact: true }).click()
  await dialog.getByRole('button', { name: 'b.md', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await choose('open workspace graph')
  let graph = page.getByRole('dialog', { name: 'workspace graph', exact: true })
  await graph.getByRole('button', { name: 'open a.md', exact: true }).waitFor()
  assert.equal(await graph.locator('[data-node]').count(), 3)
  assert.equal(await graph.locator('line').count(), 1)
  await graph.getByRole('button', { name: 'current note', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node]').length === 2,
  )
  await graph.getByRole('button', { name: 'current note', exact: true }).click()
  await graph
    .getByRole('searchbox', { name: 'filter graph notes' })
    .fill('orphan')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node]').length === 1,
  )
  await graph.getByRole('searchbox', { name: 'filter graph notes' }).fill('')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node]').length === 3,
  )
  const transform = () => graph.locator('svg > g').getAttribute('transform')
  const before = await transform()
  await graph.getByRole('button', { name: 'zoom in', exact: true }).click()
  assert.notEqual(await transform(), before)
  await graph.getByRole('button', { name: 'fit graph', exact: true }).click()
  // Dragging a node must not open it.
  const node = graph.locator('[data-node="a.md"] circle'),
    bounds = await node.boundingBox()
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(bounds.x + 60, bounds.y + 40, { steps: 8 })
  await page.mouse.up()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).name,
    'b.md',
  )
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2 })
  })
  await graph.getByRole('button', { name: 'open a.md', exact: true }).focus()
  await page.keyboard.press('Enter')
  await graph.waitFor({ state: 'hidden' })
  await page.waitForFunction(
    () => document.querySelector('.app').getAttribute('aria-busy') === 'false',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).name,
    'b.md',
  )
  assert.ok(
    (await page.evaluate(() => window.hibi.getDocument())).markdown.includes(
      '#newtag',
    ),
  )
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 })
  })
  await choose('open workspace graph')
  graph = page.getByRole('dialog', { name: 'workspace graph', exact: true })
  await graph.getByRole('button', { name: 'open a.md', exact: true }).focus()
  await page.keyboard.press('Enter')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'a.md',
  )
  await choose('disable tags')
  await choose('disable graph')
  await page.waitForFunction(
    () =>
      !document.querySelector('.hibi-tag') &&
      !document.querySelector('[data-status-id="graph.open"]'),
  )
  assert.deepEqual(errors, [])
})
