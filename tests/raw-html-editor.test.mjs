import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu, replaceRichText, replaceSourceText } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('raw HTML stays inert and exact through rich edits, atom deletion, undo, and source edits', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-raw-html-'))
  const file = join(profile, 'raw.md')
  const kbd = '<kbd>x</kbd>'
  const span = `<span id='raw-html-span' data-note="a  &amp; b" onclick="window.__rawHtmlExecuted = true">x &lt;y&gt;</span>`
  const div = [
    `<div id="raw-html-div" data-note='keep  &amp; quotes'>`,
    '  <script id="raw-html-script">window.__rawHtmlExecuted = true</script>',
    '  <img id="raw-html-img" src="data:image/png;base64,broken" onerror="window.__rawHtmlExecuted = true">',
    '  <svg id="raw-html-svg" onload="window.__rawHtmlExecuted = true"></svg>',
    '  <img src=x onerror=alert(1)>',
    '  <iframe id="raw-html-iframe" srcdoc="<script>parent.__rawHtmlExecuted = true</script>"></iframe>',
    '  <style id="raw-html-style">.tiptap { display: none !important }</style>',
    '</div>',
  ].join('\n')
  const comment = '<!--  keep <b>literal</b> &amp;  -->'
  const details = [
    '<details id="raw-html-details">',
    '<summary id="raw-html-summary">show</summary>',
    '',
    '<p id="raw-html-first">first</p>',
    '',
    '<p id="raw-html-second">second</p>',
    '</details>',
  ].join('\n')
  const original = [
    'editable paragraph',
    `inline ${kbd} and ${span}.`,
    div,
    comment,
    details,
    'last paragraph',
  ].join('\n\n')
  await writeFile(file, original)
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
  await waitForDocumentEditor(app, page)
  // Install probes before opening workspace markup, including detached DOM parsing.
  await page.evaluate(() => {
    window.__rawHtmlExecuted = false
    window.alert = () => {
      window.__rawHtmlExecuted = true
    }
    window.__rawHtmlCreated = []
    const record = (root) => {
      if (root.matches?.('[id^="raw-html-"]'))
        window.__rawHtmlCreated.push(root.id)
      for (const node of root.querySelectorAll?.('[id^="raw-html-"]') ?? [])
        window.__rawHtmlCreated.push(node.id)
    }
    new MutationObserver((records) => {
      for (const mutation of records)
        for (const node of mutation.addedNodes) record(node)
    }).observe(document, { childList: true, subtree: true })
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      const result = parse.apply(this, args)
      record(result)
      return result
    }
  })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
  await clickMenu(app, 'Open…')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).name === 'raw.md',
  )
  await waitForDocumentEditor(app, page)
  const rich = page.getByRole('textbox', {
    name: 'Document editor',
    exact: true,
  })
  const serialize = () =>
    rich.evaluate((element) => element.editor.getMarkdown())
  const inert = async () => {
    assert.equal(
      await rich
        .locator(
          'kbd, details, summary, script, style, img, svg, iframe, object, embed, input, [id^="raw-html-"]',
        )
        .count(),
      0,
      'workspace HTML must never become live editor elements',
    )
    assert.deepEqual(
      await page.evaluate(() => ({
        executed: window.__rawHtmlExecuted,
        created: window.__rawHtmlCreated,
      })),
      { executed: false, created: [] },
    )
  }
  assert.equal(
    await serialize(),
    original,
    'full serializer must retain every HTML byte',
  )
  const atoms = await rich.evaluate((element) => {
    const result = []
    element.editor.state.doc.descendants((node, pos) => {
      if (!['rawHtmlInline', 'rawHtmlBlock'].includes(node.type.name)) return
      const dom = element.editor.view.nodeDOM(pos)
      result.push({
        type: node.type.name,
        atom: node.isAtom,
        size: node.nodeSize,
        source: node.attrs.source,
        level: dom.getAttribute('data-raw-html'),
        editable: dom.getAttribute('contenteditable'),
        text: dom.querySelector('code')?.textContent,
      })
    })
    return result
  })
  for (const [source, level] of [
    [kbd, 'inline'],
    [span, 'inline'],
    [div, 'block'],
    [comment, 'block'],
    ...details.split('\n\n').map((source) => [source, 'block']),
  ]) {
    const atom = atoms.find(
      (node) => node.source.replace(/\n+$/, '') === source,
    )
    assert.ok(atom, `missing ${level} atom: ${source}`)
    assert.equal(
      atom.type,
      level === 'inline' ? 'rawHtmlInline' : 'rawHtmlBlock',
    )
    assert.equal(atom.atom, true)
    assert.equal(atom.size, 1)
    assert.equal(atom.level, level)
    assert.equal(atom.editable, 'false')
    assert.equal(
      atom.text,
      atom.source,
      'chip must show literal source in code text',
    )
  }
  await inert()

  const edited = original.replace('editable paragraph', 'edited paragraph')
  await replaceRichText(page, rich.locator('p').first(), 'edited paragraph')
  await waitForAsync(
    page,
    async (expected) => (await window.hibi.getDocument()).markdown === expected,
    edited,
  )
  assert.equal(await serialize(), edited)
  await page.evaluate(() => window.hibi.saveDocument(false))
  assert.equal(
    await readFile(file, 'utf8'),
    edited,
    'unrelated edits must save original HTML bytes',
  )

  for (const [source, level, removed] of [
    [kbd, 'inline', edited.replace(kbd, '')],
    [div, 'block', edited.replace(`\n\n${div}`, '')],
  ]) {
    const before = await rich.evaluate((element) => element.editor.getJSON())
    await rich
      .locator(`[data-raw-html="${level}"]`)
      .filter({ hasText: source })
      .click()
    const selection = await rich.evaluate((element) => {
      const { selection } = element.editor.state
      return {
        source: selection.node?.attrs.source,
        atom: selection.node?.isAtom,
        size: selection.to - selection.from,
      }
    })
    assert.equal(selection.source.replace(/\n+$/, ''), source)
    assert.equal(selection.atom, true)
    assert.equal(selection.size, 1, 'native click must select whole atom')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await rich.press('Delete')
    await waitForAsync(
      page,
      async (expected) =>
        (await window.hibi.getDocument()).markdown === expected,
      removed,
    )
    assert.equal(
      await serialize(),
      removed,
      'delete must remove only selected HTML atom',
    )
    await rich.press('ControlOrMeta+z')
    await waitForAsync(
      page,
      async (expected) =>
        (await window.hibi.getDocument()).markdown === expected,
      edited,
    )
    assert.deepEqual(
      await rich.evaluate((element) => element.editor.getJSON()),
      before,
    )
    assert.equal(
      await serialize(),
      edited,
      'undo must restore exact HTML source',
    )
  }

  await page
    .getByRole('button', { name: /^source view$/i, exact: true })
    .click()
  await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
  const sourceEdited = edited.replace(kbd, '<kbd>y</kbd>')
  await replaceSourceText(
    page,
    page.getByRole('textbox', { name: 'Markdown editor', exact: true }),
    sourceEdited,
  )
  await waitForAsync(
    page,
    async (expected) => (await window.hibi.getDocument()).markdown === expected,
    sourceEdited,
  )
  await page.getByRole('button', { name: /^normal$/i, exact: true }).click()
  await waitForDocumentEditor(app, page)
  assert.equal(await serialize(), sourceEdited)
  assert.equal(
    await rich.locator('[data-raw-html="inline"] code').first().textContent(),
    '<kbd>y</kbd>',
  )
  await inert()
  await page.evaluate(() => window.hibi.saveDocument(false))
  assert.equal(await readFile(file, 'utf8'), sourceEdited)
})
