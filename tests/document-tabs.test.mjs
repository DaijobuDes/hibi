import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { clickMenu, pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('overflowing tabs reveal close buttons smoothly and reorder without losing drafts', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-tab-overflow-'))
  const files = Array.from({ length: 8 }, (_, index) =>
    join(root, `note-${index}-with-a-long-filename.md`),
  )
  for (const file of files) await writeFile(file, 'saved note')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(root, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  await page.setViewportSize({ width: 720, height: 600 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const open = async (file) => {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
    }, file)
    await clickMenu(app, 'Open…')
    await waitForAsync(
      page,
      async (name) => (await window.hibi.getDocument()).name === name,
      basename(file),
    )
    await page.waitForFunction(
      () =>
        document.querySelector('.app').getAttribute('aria-busy') === 'false',
    )
  }
  for (const file of files.slice(0, -1)) await open(file)
  await page.locator('.document-tabs').evaluate((strip) => {
    strip.scrollTo({ left: 0, behavior: 'instant' })
    window.tabScrollFrames = []
    window.sampleTabScroll = true
    const sample = () => {
      window.tabScrollFrames.push(strip.scrollLeft)
      if (window.sampleTabScroll) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await open(files.at(-1))
  await page.waitForFunction(() => {
    const strip = document.querySelector('.document-tabs')
    return (
      strip.scrollWidth > strip.clientWidth &&
      Math.abs(strip.scrollLeft - strip.scrollWidth + strip.clientWidth) < 1
    )
  })
  const frames = await page.evaluate(() => {
    window.sampleTabScroll = false
    return window.tabScrollFrames
  })
  assert.ok(
    new Set(frames.map(Math.round)).size > 2,
    'scrolling must include intermediate positions',
  )
  const fullyVisible = () =>
    page.waitForFunction(() => {
      const strip = document
        .querySelector('.document-tabs')
        .getBoundingClientRect()
      const tab = document.querySelector('.document-tab[data-active="true"]')
      const pill = tab.getBoundingClientRect(),
        close = tab.querySelector('.tab-close').getBoundingClientRect()
      return (
        pill.left >= strip.left - 1 &&
        pill.right <= strip.right + 1 &&
        close.right <= strip.right + 1
      )
    })
  await fullyVisible()
  await open(files[0])
  await fullyVisible()
  await page
    .getByRole('textbox', { name: /document editor/i })
    .fill('keep this reordered draft')
  let state = await page.evaluate(() => window.hibi.getDocument())
  const activeId = state.tabId,
    neighbor = state.tabs[1].id
  const active = page.locator(`[data-tab-id="${activeId}"]`)
  await active.press('Alt+Shift+ArrowRight')
  await waitForAsync(
    page,
    async (id) => (await window.hibi.getDocument()).tabs[1].id === id,
    activeId,
  )
  await page.waitForFunction(
    (id) =>
      document.querySelector('.document-tabs').children[1]?.dataset.tabKey ===
      id,
    activeId,
  )
  await fullyVisible()
  await active.dragTo(page.locator(`[data-tab-id="${neighbor}"]`), {
    targetPosition: { x: 8, y: 10 },
  })
  await waitForAsync(
    page,
    async (id) => (await window.hibi.getDocument()).tabs[0].id === id,
    activeId,
  )
  state = await page.evaluate(() => window.hibi.getDocument())
  assert.equal(state.tabId, activeId)
  assert.equal(state.markdown, 'keep this reordered draft')
  assert.equal(state.tabs.length, files.length)
  await assert.rejects(
    page.evaluate(() => window.hibi.moveDocumentTab('missing', null)),
    /no longer open/,
  )
  await assert.rejects(
    page.evaluate((id) => window.hibi.moveDocumentTab(id, 'missing'), activeId),
    /no longer open/,
  )
  const order = state.tabs.map((tab) => tab.id)
  await page.reload()
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  assert.deepEqual(
    await page
      .locator('.document-tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.tabKey)),
    order,
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'keep this reordered draft',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(files.at(-1))
  await fullyVisible()
  assert.equal(
    await page
      .locator('.document-tabs')
      .evaluate((strip) => getComputedStyle(strip).scrollBehavior),
    'auto',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const closingId = (await page.evaluate(() => window.hibi.getDocument())).tabId
  await page.locator('.document-tabs').evaluate((strip) => {
    window.tabWidths = []
    window.sampleTabWidths = true
    const sample = () => {
      window.tabWidths.push(strip.scrollWidth)
      if (window.sampleTabWidths) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.locator(`[data-tab-key="${closingId}"] .tab-close`).click()
  await page
    .locator(`[data-tab-key="${closingId}"]`)
    .waitFor({ state: 'detached' })
  const widths = await page.evaluate(() => {
    window.sampleTabWidths = false
    return window.tabWidths
  })
  assert.ok(
    new Set(widths).size > 2,
    'closing an overflowing strip must include intermediate widths',
  )
  await fullyVisible()
})

test('single-file mode guards replacement, closes other tabs safely, and persists', {
  timeout: 45000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-single-file-'))
  const notes = join(root, 'notes')
  await mkdir(notes)
  const a = join(notes, 'a.md'),
    b = join(notes, 'b.md'),
    savedDraft = join(notes, 'saved.md')
  await writeFile(a, 'original a')
  await writeFile(b, 'original b')
  const launch = () =>
    electron.launch({
      args: [resolve('.'), `--user-data-dir=${join(root, 'profile')}`],
    })
  let app = await launch()
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  let page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  await page
    .getByRole('textbox', { name: /document editor/i })
    .fill('keep this draft')
  await app.evaluate(
    ({ dialog }, { b, savedDraft }) => {
      globalThis.choice = 2
      dialog.showMessageBox = async () => ({ response: globalThis.choice })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [b] })
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: savedDraft,
      })
    },
    { b, savedDraft },
  )
  await clickMenu(app, 'Open…')
  await page.getByRole('tab', { name: 'b.md', exact: true }).waitFor()
  await clickMenu(app, 'Settings')
  await page.getByRole('tab', { name: /^editor$/i, exact: true }).click()
  await page.locator('#document-tabs').click()
  await page.waitForFunction(
    () => document.querySelector('.app').getAttribute('aria-busy') === 'false',
  )
  assert.equal(await page.locator('#document-tabs').isChecked(), true)
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).tabs.length,
    2,
  )
  await app.evaluate(() => {
    globalThis.choice = 0
  })
  await page.locator('#document-tabs').click()
  await page.waitForFunction(
    () => !document.querySelector('#document-tabs').checked,
  )
  await page.waitForFunction(
    () =>
      document.querySelector('#document-tabs').getAttribute('aria-disabled') ===
      'false',
  )
  assert.equal(await readFile(savedDraft, 'utf8'), 'keep this draft')
  await page.keyboard.press('Escape')
  assert.equal(
    await page.getByRole('tablist', { name: 'Open documents' }).count(),
    0,
  )
  assert.match(
    await page.locator('.single-document-title').innerText(),
    /b\.md/,
  )
  await page
    .getByRole('textbox', { name: /document editor/i })
    .fill('changed b')
  await page
    .locator('.single-document-title')
    .getByRole('status', { name: /unsaved changes/i })
    .waitFor()
  await app.evaluate(({ dialog }, notes) => {
    globalThis.choice = 2
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [notes],
    })
  }, notes)
  await page.evaluate(() => window.hibi.openWorkspace())
  assert.equal(
    await page.evaluate(() => window.hibi.openWorkspaceFile('a.md')),
    null,
  )
  let document = await page.evaluate(() => window.hibi.getDocument())
  assert.equal(document.name, 'b.md')
  assert.equal(document.markdown, 'changed b')
  assert.equal(document.tabs.length, 1)
  await app.evaluate(() => {
    globalThis.choice = 0
  })
  document = await page.evaluate(() => window.hibi.openWorkspaceFile('a.md'))
  assert.equal(document.name, 'a.md')
  assert.equal(document.tabs.length, 1)
  assert.equal(await readFile(b, 'utf8'), 'changed b')
  await page.evaluate(() => window.hibi.updateDocument('changed a'))
  await assert.rejects(
    page.evaluate(() => window.hibi.openWorkspaceFile('missing.md')),
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'changed a',
  )
  await app.evaluate(() => {
    globalThis.choice = 2
  })
  assert.equal(await page.evaluate(() => window.hibi.newDocument()), null)
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'changed a',
  )
  await app.evaluate(() => {
    globalThis.choice = 1
  })
  document = await page.evaluate(() => window.hibi.newDocument())
  assert.equal(document.markdown, '')
  assert.equal(document.tabs.length, 1)
  assert.equal(await readFile(a, 'utf8'), 'original a')
  await assert.rejects(
    page.evaluate(() => window.hibi.setTabsEnabled('invalid')),
    /Invalid tabs preference/,
  )
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).tabsEnabled,
    false,
  )
  assert.equal(
    await page.getByRole('tablist', { name: 'Open documents' }).count(),
    0,
  )
  await clickMenu(app, 'Settings')
  await page.getByRole('tab', { name: /^editor$/i, exact: true }).click()
  await page.locator('#document-tabs').click()
  await page.waitForFunction(
    () => document.querySelector('#document-tabs').checked,
  )
  await page.waitForFunction(
    () =>
      document.querySelector('#document-tabs').getAttribute('aria-disabled') ===
      'false',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('tablist', { name: 'Open documents' }).waitFor()
  await clickMenu(app, 'New')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).tabs.length === 2,
  )
})

test('tab entry and exit animate, while reduced motion removes transitions', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-tab-motion-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  await page.getByRole('textbox', { name: /document editor/i }).waitFor()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const first = (await page.evaluate(() => window.hibi.getDocument())).tabId
  const observe = (name) =>
    page.evaluate(
      ({ name, first }) => {
        window.tabMotion = null
        const observer = new MutationObserver(() => {
          const tab = [...document.querySelectorAll('.document-tab')].find(
            (tab) =>
              tab
                .querySelector('[data-tab-id]')
                ?.getAttribute('data-tab-id') !== first &&
              getComputedStyle(tab).animationName === name,
          )
          const animation = tab?.getAnimations()[0]
          if (!animation) return
          observer.disconnect()
          animation.pause()
          animation.currentTime = 80
          const style = getComputedStyle(tab)
          window.tabMotion = {
            opacity: Number(style.opacity),
            x: new DOMMatrixReadOnly(style.transform).m41,
          }
          animation.finish()
        })
        observer.observe(document.querySelector('.document-tabs'), {
          childList: true,
          subtree: true,
          attributes: true,
        })
      },
      { name, first },
    )
  await observe('tab-open')
  await clickMenu(app, 'New')
  await page.waitForFunction(() => window.tabMotion)
  let sample = await page.evaluate(() => window.tabMotion)
  assert.ok(
    sample.opacity > 0 && sample.opacity < 1 && sample.x < 0 && sample.x > -10,
  )
  await observe('tab-close')
  await page
    .getByRole('button', { name: /^close untitled\.md$/i })
    .last()
    .click()
  await page.waitForFunction(() => window.tabMotion)
  sample = await page.evaluate(() => window.tabMotion)
  assert.ok(
    sample.opacity > 0 && sample.opacity < 1 && sample.x < 0 && sample.x > -10,
  )
  await page.waitForFunction(
    () => !document.querySelector('.document-tab[data-closing="true"]'),
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await clickMenu(app, 'New')
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).tabs.length === 2,
  )
  assert.equal(
    await page
      .locator('.document-tab')
      .last()
      .evaluate((tab) => getComputedStyle(tab).animationName),
    'none',
  )
})

test('file tabs preserve independent drafts and guard closing, saving, and workspace mutations', {
  timeout: 40000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-tabs-'))
  const notes = join(root, 'notes')
  await mkdir(join(notes, 'folder'), { recursive: true })
  const a = join(notes, 'folder/a.md'),
    b = join(notes, 'b.md')
  await writeFile(a, 'original a')
  await writeFile(b, 'original b')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(root, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(root, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }) => {
    globalThis.choices = []
    globalThis.choice = 2
    dialog.showMessageBox = async (_window, options) => {
      globalThis.choices.push(options.message)
      return { response: globalThis.choice }
    }
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(6500)
  const rich = page.getByRole('textbox', { name: /document editor/i })
  await rich.waitFor()
  const read = () => page.evaluate(() => window.hibi.getDocument())
  const choose = (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, file)
  const waitEditable = () =>
    page.waitForFunction(
      () =>
        document.querySelector('.tiptap')?.getAttribute('contenteditable') ===
        'true',
    )
  await rich.fill('untitled draft')
  const untitled = (await read()).tabId
  await clickMenu(app, 'New')
  await waitForAsync(
    page,
    async (id) => (await window.hibi.getDocument()).tabId !== id,
    untitled,
  )
  await page.locator(`[data-tab-id="${untitled}"]`).click()
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown === 'untitled draft',
  )
  await choose(a)
  await clickMenu(app, 'Open…')
  await page.getByRole('tab', { name: /^a\.md$/i, exact: true }).waitFor()
  await waitEditable()
  await rich.fill('draft a')
  const aTab = (await read()).tabId
  await choose(b)
  await clickMenu(app, 'Open…')
  await page.getByRole('tab', { name: /^b\.md$/i, exact: true }).waitFor()
  const bTab = (await read()).tabId
  assert.equal(
    await page
      .getByRole('button', { name: /^rename document$/i, exact: true })
      .count(),
    0,
  )
  await page.getByRole('tab', { name: /^b\.md$/i, exact: true }).dblclick()
  assert.equal(
    await page
      .getByRole('textbox', { name: /^file name$/i, exact: true })
      .count(),
    0,
  )
  assert.deepEqual(await app.evaluate(() => globalThis.choices), [])
  assert.equal((await read()).tabs.find((tab) => tab.id === aTab).dirty, true)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  )
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  )
  assert.equal((await read()).tabId, bTab)
  await page
    .getByRole('button', { name: /^close a\.md$/i, exact: true })
    .click()
  await page.waitForFunction(
    () => document.querySelector('.app').getAttribute('aria-busy') === 'false',
  )
  assert.equal(
    (await read()).tabs.some((tab) => tab.id === aTab),
    true,
  )
  await app.evaluate(() => {
    globalThis.choice = 0
  })
  await page
    .getByRole('button', { name: /^close a\.md$/i, exact: true })
    .click()
  await page
    .getByRole('tab', { name: /^a\.md$/i, exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal(await readFile(a, 'utf8'), 'draft a')
  assert.equal((await read()).tabId, bTab)
  await page.locator(`[data-tab-id="${untitled}"]`).click()
  await waitEditable()
  await clickMenu(app, 'Save')
  await page
    .getByRole('alert')
    .filter({ hasText: /already open in another tab/i })
    .waitFor()
  assert.equal(await readFile(b, 'utf8'), 'original b')
  await choose(a)
  await clickMenu(app, 'Open…')
  await page.getByRole('tab', { name: /^a\.md$/i, exact: true }).waitFor()
  await waitEditable()
  await rich.fill('moved draft')
  await page.getByRole('tab', { name: /^b\.md$/i, exact: true }).click()
  await choose(notes)
  await page.evaluate(() => window.hibi.openWorkspace())
  await page.evaluate(() =>
    window.hibi.workspaceAction({
      action: 'rename',
      path: 'folder',
      destination: 'renamed',
    }),
  )
  const moved = (await read()).tabs.find((tab) => tab.name === 'a.md')
  await page.evaluate((id) => window.hibi.selectDocumentTab(id), moved.id)
  assert.equal((await read()).markdown, 'moved draft')
  await page.evaluate(() => window.hibi.saveDocument(false))
  assert.equal(
    await readFile(join(notes, 'renamed/a.md'), 'utf8'),
    'moved draft',
  )
  await page.evaluate(() => window.hibi.updateDocument('do not delete yet'))
  await page.evaluate((id) => window.hibi.selectDocumentTab(id), bTab)
  await app.evaluate(() => {
    globalThis.choice = 2
  })
  assert.equal(
    await page.evaluate(() =>
      window.hibi.workspaceAction({ action: 'delete', path: 'renamed' }),
    ),
    null,
  )
  assert.equal(
    await readFile(join(notes, 'renamed/a.md'), 'utf8'),
    'moved draft',
  )
  const first = await page.evaluate(() =>
    window.hibi.workspaceAction({ action: 'new-file', path: '' }),
  )
  const second = await page.evaluate(() =>
    window.hibi.workspaceAction({ action: 'new-file', path: '' }),
  )
  assert.notEqual(first.path, second.path)
  assert.equal(
    (await page.evaluate(() => window.hibi.getWorkspace())).entries
      .flatMap((entry) => [entry, ...(entry.children ?? [])])
      .filter((entry) => entry.dirty).length,
    3,
  )
  await page.evaluate((path) => window.hibi.openWorkspaceFile(path), first.path)
  assert.equal((await read()).tabId, first.document.tabId)
  await assert.rejects(
    page.evaluate(() =>
      window.hibi.openWorkspaceFile('../notes/' + 'untitled.md'),
    ),
    /invalid workspace/,
  )
  await assert.rejects(
    page.evaluate(() => window.hibi.selectDocumentTab('invented')),
    /no longer open/,
  )
  await app.evaluate(({ shell }) => {
    globalThis.choice = 1
    shell.trashItem = (path) =>
      process.getBuiltinModule('fs/promises').rm(path, { recursive: true })
  })
  await page.evaluate(() =>
    window.hibi.workspaceAction({ action: 'delete', path: 'renamed' }),
  )
  assert.equal(
    (await read()).tabs.some((tab) => tab.id === moved.id),
    false,
  )
  for (const tab of (await read()).tabs)
    await page.evaluate((id) => window.hibi.closeDocumentTab(id), tab.id)
  assert.equal((await read()).tabs.length, 1)
  assert.equal((await read()).markdown, '')
  await page.reload()
  await rich.waitFor()
  assert.equal(
    await page.getByRole('region', { name: /start writing/i }).count(),
    0,
  )
  const lastTab = (await read()).tabId
  await clickMenu(app, 'New')
  await waitForAsync(
    page,
    async (id) => (await window.hibi.getDocument()).tabId !== id,
    lastTab,
  )
  await pressShortcut(
    app,
    process.platform === 'darwin' ? 'Meta+w' : 'Control+w',
  )
  await waitForAsync(
    page,
    async (id) => (await window.hibi.getDocument()).tabId === id,
    lastTab,
  )
  assert.equal((await read()).tabs.length, 1)
})
