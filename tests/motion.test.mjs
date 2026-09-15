import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'
import { checkSidebarResize } from './sidebar-resize.mjs'

test('source font and layout are ready before the pane starts moving', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-cold-pane-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page.addInitScript(() => {
    const load = document.fonts.load.bind(document.fonts)
    document.fonts.load = (font, text) =>
      font.includes('Geist Mono')
        ? new Promise((resolve) => {
            window.releaseSourceFont = () => load(font, text).then(resolve)
          })
        : load(font, text)
  })
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].reload(),
    ),
  ])
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  await rich.fill('keep edits made while the source engine loads')
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  assert.equal(
    await page.locator('.editor-panes').getAttribute('data-source-ready'),
    'false',
  )
  assert.match(
    await page.locator('.editor-panes').getAttribute('class'),
    /mode-normal/,
  )
  await page.waitForFunction(
    () => typeof window.releaseSourceFont === 'function',
  )
  await page.evaluate(() => window.releaseSourceFont())
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
  assert.equal(
    await page.locator('.editor-panes').getAttribute('data-source-ready'),
    'true',
  )
  assert.equal(
    await source.innerText(),
    'keep edits made while the source engine loads',
  )
  assert.equal(
    await page.evaluate(() => document.fonts.check('13px "Geist Mono"')),
    true,
  )
})

test('panes move horizontally and sidebar selection slides without fading settings', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-motion-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page
    .getByRole('button', { name: 'toggle workspace sidebar', exact: true })
    .click()
  await page.waitForFunction(
    () =>
      document.querySelector('.editor-panes').dataset.sourceReady === 'true',
  )
  await page
    .getByRole('textbox', { name: 'document editor' })
    .fill(
      'long paragraphs should keep their wrapping while a panel slides across the window. '.repeat(
        40,
      ),
    )
  assert.equal(
    await page.getByRole('button', { name: 'format', exact: true }).count(),
    0,
  )
  assert.equal(await page.locator('#format-menu').count(), 0)

  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    )
  async function sampleSplit(from, to = 'side-by-side') {
    await page.getByRole('button', { name: from, exact: true }).click()
    await settle()
    return page.evaluate(async (target) => {
      const sample = () => {
        const rich = document
          .querySelector('.rich-pane')
          .getBoundingClientRect()
        const source = document
          .querySelector('.source-pane')
          .getBoundingClientRect()
        return {
          richX: rich.x,
          richWidth: document.querySelector('.rich-pane').offsetWidth,
          sourceX: source.x,
          sourceWidth: document.querySelector('.source-pane').offsetWidth,
        }
      }
      const samples = [sample()]
      document.querySelector(`button[aria-label="${target}"]`).click()
      const start = performance.now()
      while (performance.now() - start < 300) {
        await new Promise(requestAnimationFrame)
        samples.push(sample())
      }
      return samples
    }, to)
  }
  const fromRich = await sampleSplit('normal')
  assert.equal(fromRich[0].sourceWidth, 500)
  assert.ok(fromRich.some((frame) => frame.sourceX > -500 && frame.sourceX < 0))
  assert.equal(new Set(fromRich.map((frame) => frame.sourceWidth)).size, 1)
  assert.ok(new Set(fromRich.map((frame) => frame.richWidth)).size <= 2)
  assert.equal(fromRich.at(-1).sourceX, 0)
  assert.equal(fromRich.at(-1).richX, 500)
  const fromSource = await sampleSplit('markdown only')
  assert.equal(fromSource[0].richWidth, 500)
  assert.ok(fromSource.some((frame) => frame.richX > 510 && frame.richX < 1000))
  assert.equal(fromSource.at(-1).richX, 500)
  assert.equal(new Set(fromSource.map((frame) => frame.richWidth)).size, 1)
  const dismissSource = await sampleSplit('side-by-side', 'normal')
  assert.equal(new Set(dismissSource.map((frame) => frame.sourceWidth)).size, 1)
  const dismissRich = await sampleSplit('side-by-side', 'markdown only')
  assert.equal(new Set(dismissRich.map((frame) => frame.richWidth)).size, 1)
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  await settle()
  const divider = await page
    .locator('.editor-panes')
    .evaluate((element) => getComputedStyle(element, '::after').backgroundImage)
  assert.match(divider, /linear-gradient/)
  assert.match(divider, /rgba\(0, 0, 0, 0\)/)
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/split-view.png' })

  await page
    .getByRole('button', { name: 'editor settings', exact: true })
    .click()
  await page.getByRole('main', { name: 'settings', exact: true }).waitFor()
  await settle()
  const selection = await page.evaluate(async () => {
    const marker = document.querySelector('.category-selection')
    const top = () => marker.getBoundingClientRect().top
    const before = top()
    document.querySelector('#category-hotkeys').click()
    const frames = []
    const start = performance.now()
    while (performance.now() - start < 230) {
      await new Promise(requestAnimationFrame)
      frames.push(top())
    }
    return {
      before,
      frames,
      transitions: document
        .getAnimations()
        .some((animation) =>
          animation.effect?.pseudoElement?.includes('view-transition'),
        ),
      opacity: getComputedStyle(document.querySelector('.settings-screen'))
        .opacity,
      border: getComputedStyle(document.querySelector('.settings-sidebar'))
        .borderRightWidth,
    }
  })
  assert.ok(
    selection.frames.some(
      (top) => top > selection.before && top < selection.before + 56,
    ),
  )
  assert.equal(selection.frames.at(-1), selection.before + 56)
  assert.equal(selection.transitions, false)
  assert.equal(selection.opacity, '1')
  assert.equal(selection.border, '0px')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await page
      .locator('.category-selection')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    '0s',
  )
  await page.setViewportSize({ width: 480, height: 360 })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await page
    .getByRole('button', { name: 'command palette', exact: true })
    .click()
  await page.getByRole('dialog').waitFor()
  const bounds = await page.getByRole('dialog').boundingBox()
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 480 &&
      bounds.y + bounds.height <= 360,
  )
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: 'test-results/palette-compact-light.png' })
})

test('workspace sidebar slides at a fixed width and the titlebar follows its state', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-sidebar-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  for (const [opening, reverse] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    const samples = await page.evaluate(async (reverse) => {
      const sidebar = document.querySelector('.workspace-sidebar > .sidebar')
      const editor = document.querySelector('.editor-surface')
      const toolbar = document.querySelector('.sidebar-toolbar')
      document.querySelector('[aria-label="toggle workspace sidebar"]').click()
      const samples = []
      let reversed = false
      const start = performance.now()
      while (performance.now() - start < 320) {
        await new Promise(requestAnimationFrame)
        if (reverse && !reversed && performance.now() - start > 64) {
          document
            .querySelector('[aria-label="toggle workspace sidebar"]')
            .click()
          reversed = true
        }
        // Allow hit testing during dismissal to catch panes painting over the sidebar.
        const slot = sidebar.parentElement
        slot.inert = false
        sidebar.style.pointerEvents = 'auto'
        const right = sidebar.getBoundingClientRect().right
        const onTop =
          right > 1 &&
          document
            .elementFromPoint(right / 2, innerHeight / 2)
            ?.closest('.sidebar') === sidebar
        sidebar.style.pointerEvents = ''
        slot.inert = slot.dataset.open === 'false'
        samples.push({
          x: sidebar.getBoundingClientRect().x,
          width: sidebar.offsetWidth,
          top: sidebar.getBoundingClientRect().top,
          bottom: sidebar.getBoundingClientRect().bottom,
          viewportHeight: innerHeight,
          editorWidth: editor.offsetWidth,
          contentX: editor.getBoundingClientRect().left,
          toolbarWidth: toolbar.offsetWidth,
          visibility: getComputedStyle(sidebar).visibility,
          onTop,
          toolbarBackground: getComputedStyle(toolbar).backgroundColor,
          titlebarBackground: getComputedStyle(toolbar.parentElement)
            .backgroundColor,
        })
      }
      return samples
    }, reverse)
    assert.ok(samples.some(({ x }) => x > -195 && x < -1))
    assert.ok(
      samples
        .filter(({ x }) => x > -195 && x < -1)
        .every(({ visibility, onTop }) => visibility === 'visible' && onTop),
    )
    assert.ok(
      samples.every(
        ({ toolbarBackground, titlebarBackground }) =>
          toolbarBackground === 'rgba(0, 0, 0, 0)' &&
          titlebarBackground === 'rgba(0, 0, 0, 0)',
      ),
    )
    assert.deepEqual([...new Set(samples.map(({ width }) => width))], [196])
    assert.ok(
      samples.every(
        ({ top, bottom, viewportHeight }) =>
          top === 0 && bottom === viewportHeight,
      ),
    )
    assert.equal(
      new Set(samples.map(({ editorWidth }) => editorWidth)).size,
      reverse ? 2 : 1,
    )
    assert.ok(
      samples.every(
        ({ x, width, contentX }) => Math.abs(contentX - x - width) < 1,
      ),
    )
    assert.equal(samples.at(-1).x, opening ? 0 : -196)
    assert.equal(samples.at(-1).toolbarWidth, opening ? 196 : 112)
  }
  await page.getByRole('button', { name: 'editor settings' }).click()
  assert.equal(
    await page.locator('.sidebar-toolbar').evaluate((el) => el.offsetWidth),
    196,
  )
  assert.equal(
    await page.getByRole('button', { name: 'new', exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'back to editor' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'toggle workspace sidebar' }).click()
  assert.equal(
    await page.locator('.workspace-sidebar').evaluate((el) => el.inert),
    true,
  )
  assert.equal(
    await page
      .locator('.workspace-sidebar > .sidebar')
      .evaluate((el) => getComputedStyle(el).visibility),
    'hidden',
  )
  await page.getByRole('button', { name: 'toggle workspace sidebar' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await checkSidebarResize(page, 196, '.editor-surface', async () => {
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].reload(),
      ),
    ])
  })
  await page.getByRole('button', { name: 'editor settings' }).click()
  const resize = page.getByRole('separator', { name: 'resize sidebar' })
  await resize.press('ArrowRight')
  assert.equal(Number(await resize.getAttribute('aria-valuenow')), 204)
  await page.getByRole('button', { name: 'back to editor' }).click()
  assert.equal(
    Number(
      await page
        .locator('.workspace-sidebar')
        .getByRole('separator', { name: 'resize sidebar' })
        .getAttribute('aria-valuenow'),
    ),
    204,
  )
})
