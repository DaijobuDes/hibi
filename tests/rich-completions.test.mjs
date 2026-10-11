import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('rich completions replace exact plain text in one undo step and retract on disposal', {
  timeout: 45000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-rich-completions-'))
  const folder = join(profile, 'installed-addons', 'completion-probe')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'hibi-addon.json'),
    JSON.stringify({
      id: 'completion-probe',
      name: 'Completion probe',
      description: 'Rich completion adapter test.',
      kind: 'extension',
      apiVersion: 2,
      version: '1.0.0',
      startup: 'background',
      capabilities: [],
      authors: [{ displayName: 'Test' }],
      entry: 'index.js',
    }),
  )
  await writeFile(
    join(folder, 'index.js'),
    `export default () => ({
    async start(context) {
      window.completionSignals = []
      window.completionAccepted = []
      context.editor.onTypingContext(event => window.completionSignals.push(event))
      window.completionCalls = 0
      window.completionUnsafeRange = false
      window.completionReplacement = 'hello'
      const dispose = await context.editor.registerCompletionProvider(async (request) => {
        if (request.editor !== 'rich') return []
        window.completionCalls++
        if (!request.before.endsWith('hel')) return []
        return [{
          label: 'hello',
          detail: 'plain text',
          insertText: window.completionReplacement,
          from: window.completionUnsafeRange ? 0 : request.selection.head - 3,
          to: request.selection.head,
        }]
      }, { onAccepted(request, item) { window.completionAccepted.push({request, item}) } })
      window.stopCompletionProbe = dispose
      window.completionProbeReady = true
    },
  })`,
  )
  await writeFile(
    join(folder, '.hibi-install.json'),
    JSON.stringify({
      hash: 'a'.repeat(64),
      files: ['hibi-addon.json', 'index.js'],
      source: 'local',
    }),
  )
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({
      'completion-probe': true,
    }),
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
  page.setDefaultTimeout(8000)
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  await rich.waitFor()
  await page.waitForFunction(() => window.completionProbeReady === true)
  assert.deepEqual(await page.evaluate(() => window.completionSignals), [])
  await rich.click()
  await page.keyboard.type('hel')
  const menu = page.getByRole('listbox', { name: 'Completions' })
  await menu.getByRole('option', { name: /hello/ }).waitFor()
  await page.waitForFunction(
    () => window.completionSignals.at(-1)?.before === 'hel',
  )
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown.trim() === 'hello',
  )
  assert.equal(await page.evaluate(() => window.completionAccepted.length), 1)
  await pressShortcut(
    app,
    `${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`,
  )
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown.trim() === 'hel',
  )
  await page.waitForFunction(
    () => window.completionSignals.at(-1)?.kind === 'undo',
  )
  assert.equal(await page.evaluate(() => window.completionAccepted.length), 1)
  await page.evaluate(() => {
    window.completionReplacement = '[[proof-note]]'
  })
  await page.keyboard.press('Control+Space')
  await menu.getByRole('option', { name: /hello/ }).waitFor()
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown.trim() === '[[proof-note]]',
  )
  assert.equal(
    await rich.locator('a[data-wiki-link="proof-note"]').innerText(),
    'proof-note',
  )
  await rich.evaluate((element) => element.editor.commands.undo())
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown.trim() === 'hel',
  )
  await rich.evaluate((element) => element.editor.commands.redo())
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown.trim() === '[[proof-note]]',
  )
  await rich.evaluate((element) => {
    const editor = element.editor
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.view.focus()
  })
  await page.keyboard.insertText('x')
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown.trim() === '[[proof-note]]x',
  )
  await rich.evaluate((element) => element.editor.commands.undo())
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown.trim() === '[[proof-note]]',
  )
  await rich.evaluate((element) => element.editor.commands.undo())
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown.trim() === 'hel',
  )
  await page.evaluate(() => {
    window.completionReplacement = 'hello'
  })
  await page.keyboard.press('Control+Space')
  await menu.getByRole('option', { name: /hello/ }).waitFor()
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown.trim(),
    'hel',
  )
  const beforeUnsafe = await page.evaluate(() => {
    window.completionUnsafeRange = true
    return window.completionCalls
  })
  await page.keyboard.press('Control+Space')
  await page.waitForFunction(
    (before) => window.completionCalls > before,
    beforeUnsafe,
  )
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  await menu.waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    window.completionUnsafeRange = false
  })
  const reset = async (text) => {
    await rich.evaluate((element, text) => {
      const editor = element.editor
      window.completionSignals = []
      editor.commands.setContent(text, { contentType: 'markdown' })
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.view.focus()
    }, text)
    assert.deepEqual(await page.evaluate(() => window.completionSignals), [])
  }
  for (const text of [
    '```\nsecret\n```',
    '`secret`',
    '[secret](https://private.example)',
    'password: secret',
    '/heading',
  ]) {
    await reset(text)
    await page.keyboard.type('x')
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    )
    assert.deepEqual(
      await page.evaluate(() => window.completionSignals),
      [],
      text,
    )
    await page.keyboard.press('Escape')
  }
  await reset('boundaryword')
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => window.completionSignals.at(-1)?.before === 'boundaryword\n',
  )
  await reset('bro ')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: '日',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await page.waitForFunction(() =>
    document.querySelector('.rich-pane .tiptap').textContent.includes('日'),
  )
  assert.deepEqual(await page.evaluate(() => window.completionSignals), [])
  await cdp.send('Input.imeSetComposition', {
    text: '日本',
    selectionStart: 2,
    selectionEnd: 2,
  })
  await cdp.send('Input.insertText', { text: '日本語' })
  await page.waitForFunction(() =>
    window.completionSignals.some((event) => event.kind === 'composition'),
  )
  assert.equal(await page.evaluate(() => window.completionSignals.length), 1)
  assert.equal(
    await page.evaluate(() => window.completionSignals[0].before),
    'bro 日本語',
  )
  await cdp.detach()
  await reset('hel')
  await page.keyboard.press('Control+Space')
  await menu.getByRole('option', { name: /hello/ }).waitFor()
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  const acceptedCount = await page.evaluate(
    () => window.completionAccepted.length,
  )
  await rich.evaluate((element) => {
    const editor = element.editor
    editor.view.dom.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertFromPaste',
        bubbles: true,
      }),
    )
    editor.view.dispatch(
      editor.state.tr
        .insertText('private pasted text', 1, 6)
        .setMeta('uiEvent', 'paste'),
    )
  })
  await page.waitForFunction(
    () => window.completionSignals.at(-1)?.kind === 'replace',
  )
  assert.deepEqual(
    await page.evaluate(() => ({
      before: window.completionSignals.at(-1).before,
      after: window.completionSignals.at(-1).after,
    })),
    { before: '', after: '' },
  )
  assert.equal(
    await page.evaluate(() => window.completionAccepted.length),
    acceptedCount,
  )
  await reset('hel')
  await page.keyboard.press('Control+Space')
  await menu.getByRole('option', { name: /hello/ }).waitFor()
  await page.evaluate(() => window.stopCompletionProbe())
  await menu.waitFor({ state: 'hidden' })
  const calls = await page.evaluate(() => window.completionCalls)
  await page.keyboard.type('x')
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  assert.equal(await page.evaluate(() => window.completionCalls), calls)
})
