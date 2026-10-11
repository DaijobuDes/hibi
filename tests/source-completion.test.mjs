import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

test('source completions stream, accept in one undo step, and retract on provider disposal', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-source-completion-'))
  const directory = join(profile, 'installed-addons', 'completion-probe')
  const file = join(profile, 'note.md')
  await mkdir(directory, { recursive: true })
  await writeFile(file, 'a')
  await writeFile(
    join(directory, 'hibi-addon.json'),
    JSON.stringify({
      id: 'completion-probe',
      name: 'Completion probe',
      description: 'Source completion fixture',
      kind: 'extension',
      authors: [{ displayName: 'Test' }],
      apiVersion: 2,
      version: '1.0.0',
      startup: 'background',
      capabilities: [],
      entry: 'index.js',
    }),
  )
  await writeFile(
    join(directory, '.hibi-install.json'),
    JSON.stringify({
      hash: 'a'.repeat(64),
      files: ['index.js', 'hibi-addon.json'],
      source: 'local',
    }),
  )
  await writeFile(
    join(directory, 'index.js'),
    `export default () => ({ async start(context) {
      window.completionProbe = { requests: [], pending: [] };
      const stops = [];
      stops.push(await context.editor.registerCompletionProvider((request) => {
        window.completionProbe.requests.push(request);
        return [{ label: 'beta', insertText: 'beta', from: request.selection.head - 1, to: request.selection.head }];
      }));
      stops.push(await context.editor.registerCompletionProvider((request, signal) => {
        if (request.trigger.kind !== 'explicit') return [];
        return new Promise(resolve => window.completionProbe.pending.push({
          signal,
          resolve(label) { resolve([{ label, insertText: label, from: request.selection.head - 1, to: request.selection.head }]); }
        }));
      }));
      stops.push(await context.editor.registerContextActionProvider((request) => [{
        label: 'Probe action',
        edit: { from: request.selection.head, to: request.selection.head, insertText: '!' },
      }]));
      window.completionProbe.dispose = () => stops.forEach(stop => stop());
      window.completionProbe.ready = true;
    } });`,
  )
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ 'completion-probe': true }),
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
  const page = await app.firstWindow()
  page.setDefaultTimeout(7000)
  await page.getByRole('textbox', { name: 'Document editor' }).waitFor()
  await page.waitForFunction(() => window.completionProbe?.ready)
  await page.evaluate(() => localStorage.setItem('default-view', 'markdown'))
  await page.reload()
  await page.waitForFunction(() => window.completionProbe?.ready)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
  await clickMenu(app, 'Open…')
  const source = page.getByRole('textbox', {
    name: 'Markdown editor',
    exact: true,
  })
  await source.waitFor()
  await page.waitForFunction(() => {
    const content = document.querySelector('.source-pane .cm-content')
    return content?.isContentEditable && content.textContent === 'a'
  })
  await source.focus()
  await source.press(
    process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End',
  )
  await page.keyboard.type('b')
  await page
    .locator('.cm-tooltip-autocomplete .cm-completionLabel', {
      hasText: 'beta',
    })
    .waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.completionProbe.requests.at(-1)?.trigger),
    { kind: 'input', character: 'b' },
  )
  // CodeMirror guards newly opened menus from immediate accidental acceptance.
  await page.waitForTimeout(100)
  await source.press('Tab')
  await page.waitForFunction(
    async () => (await window.hibi.getDocument()).markdown === 'abeta',
  )
  await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await page.waitForFunction(
    async () => (await window.hibi.getDocument()).markdown === 'ab',
  )
  // The editor actions menu owns the keys as well: completions stay closed
  // while it is open, and opening it closes them.
  const actions = page.getByRole('menu', { name: 'Editor actions' })
  await source.press('Shift+F10')
  await actions.getByRole('menuitem', { name: 'Probe action' }).waitFor()
  const actionRequests = await page.evaluate(
    () => window.completionProbe.requests.length,
  )
  await page.keyboard.press('Control+Space')
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  assert.equal(
    await page.locator('.cm-tooltip-autocomplete').isVisible(),
    false,
  )
  assert.equal(
    await page.evaluate(() => window.completionProbe.requests.length),
    actionRequests,
  )
  await page.keyboard.press('Escape')
  await actions.waitFor({ state: 'hidden' })
  await source.press('Control+Space')
  await page.locator('.cm-tooltip-autocomplete').waitFor()
  await source.press('Shift+F10')
  await actions.getByRole('menuitem', { name: 'Probe action' }).waitFor()
  await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await actions.waitFor({ state: 'hidden' })
  // Settle the explicit request the actions menu canceled; it holds its
  // provider's slot until then.
  await page.waitForFunction(() => window.completionProbe.pending.length > 0)
  await page.evaluate(() => {
    for (const pending of window.completionProbe.pending.splice(0))
      pending.resolve('canceled')
  })

  await source.press('Control+Space')
  await page
    .locator('.cm-tooltip-autocomplete .cm-completionLabel', {
      hasText: 'beta',
    })
    .waitFor()
  await page.waitForFunction(() => window.completionProbe.pending.length > 0)
  await page.evaluate(() =>
    window.completionProbe.pending.at(-1).resolve('bravo'),
  )
  await page
    .locator('.cm-tooltip-autocomplete .cm-completionLabel', {
      hasText: 'bravo',
    })
    .waitFor()
  await source.press('Escape')
  await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'hidden' })

  // An open slash menu keeps its keys; completions stay closed.
  const slash = page.getByRole('listbox', { name: 'Slash commands' })
  await source.press('Enter')
  await page.keyboard.type('/')
  await slash.waitFor()
  const slashRequests = await page.evaluate(
    () => window.completionProbe.requests.length,
  )
  await page.keyboard.type('quo')
  await slash.getByRole('option', { name: /Quotes/ }).waitFor()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  assert.equal(
    await page.locator('.cm-tooltip-autocomplete').isVisible(),
    false,
  )
  assert.equal(
    await page.evaluate(() => window.completionProbe.requests.length),
    slashRequests,
  )
  await source.press('Escape')
  await slash.waitFor({ state: 'hidden' })
  for (let i = 0; i < 5; i++) await source.press('Backspace')
  await page.waitForFunction(
    async () => (await window.hibi.getDocument()).markdown === 'ab',
  )

  await source.press('Control+Space')
  await page
    .locator('.cm-tooltip-autocomplete .cm-completionLabel', {
      hasText: 'beta',
    })
    .waitFor()
  await page.evaluate(() => window.completionProbe.dispose())
  await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'hidden' })
  const count = await page.evaluate(
    () => window.completionProbe.requests.length,
  )
  await source.press('x')
  assert.equal(
    await page.evaluate(() => window.completionProbe.requests.length),
    count,
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'abx',
  )
})
