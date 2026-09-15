import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'
import { pressShortcut } from './keyboard.mjs'

test('cursor appearance, movement, selection hiding, and persistence in both editors', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-cursor-'))
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
  // Exercise caret rendering without taking focus from the user's active window.
  await page.evaluate(() => {
    document.hasFocus = () => true
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.locator('.editor-cursor').waitFor()
  const emptyGeometry = await page.evaluate(() => {
    const caret = document
      .querySelector('.editor-cursor')
      .getBoundingClientRect()
    const baseline = document
      .querySelector('.tiptap p br')
      .getBoundingClientRect()
    return {
      x: caret.x - baseline.x,
      y: caret.y - baseline.y,
      height: caret.height - baseline.height,
    }
  })
  assert.ok(
    Object.values(emptyGeometry).every(
      (difference) => Math.abs(difference) < 1,
    ),
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    '',
  )
  await rich.fill('cursor movement sample')
  const cursor = page.locator('.editor-cursor')
  await cursor.waitFor()
  assert.equal(await cursor.getAttribute('data-style'), 'bar')
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'appearance', exact: true }).click()
  await page.getByLabel('cursor style', { exact: true }).selectOption('outline')
  await page.getByLabel('cursor blink', { exact: true }).selectOption('fast')
  await page
    .getByLabel('cursor animation', { exact: true })
    .selectOption('smooth')
  await page.getByRole('button', { name: 'back to editor' }).click()
  await cursor.waitFor()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  const before = (await cursor.boundingBox()).x
  await rich.press('ArrowLeft')
  const motion = await page.evaluate(async () => {
    const points = []
    const start = performance.now()
    while (performance.now() - start < 160) {
      await new Promise(requestAnimationFrame)
      points.push(
        document.querySelector('.editor-cursor').getBoundingClientRect().x,
      )
    }
    const style = getComputedStyle(
      document.querySelector('.editor-cursor'),
      '::after',
    )
    return {
      points,
      duration: style.animationDuration,
      name: style.animationName,
      border: style.borderTopWidth,
    }
  })
  assert.ok(motion.points.some((x) => x < before && x > motion.points.at(-1)))
  assert.equal(motion.duration, '0.6s')
  assert.equal(motion.name, 'cursor-smooth')
  assert.notEqual(motion.border, '0px')
  await pressShortcut(
    app,
    process.platform === 'darwin' ? 'Meta+Shift+\\' : 'Control+Shift+\\',
  )
  await page.waitForFunction(
    () =>
      document
        .querySelector('.editor-panes')
        .classList.contains('mode-side-by-side') &&
      document.querySelector('.rich-pane').getAnimations().length === 0,
  )
  assert.ok(
    await page.evaluate(
      () =>
        Math.abs(
          document.getSelection().getRangeAt(0).getBoundingClientRect().left -
            document.querySelector('.editor-cursor').getBoundingClientRect()
              .left,
        ) < 1,
    ),
  )
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  for (const [shape, speed] of [
    ['block', 'slow'],
    ['underline', 'normal'],
  ]) {
    await page.getByRole('button', { name: 'editor settings' }).click()
    await page.getByLabel('cursor style', { exact: true }).selectOption(shape)
    await page.getByLabel('cursor blink', { exact: true }).selectOption(speed)
    await page
      .getByLabel('cursor animation', { exact: true })
      .selectOption('blink')
    await page.getByRole('button', { name: 'back to editor' }).click()
    await cursor.waitFor()
    assert.equal(await cursor.getAttribute('data-style'), shape)
    assert.equal(
      await cursor.evaluate(
        (element) => getComputedStyle(element, '::after').animationDuration,
      ),
      speed === 'slow' ? '1.6s' : '1s',
    )
    assert.equal(await cursor.getAttribute('data-move'), 'false')
  }
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.fill('source cursor sample')
  await cursor.waitFor()
  assert.equal(
    await source.evaluate((element) => getComputedStyle(element).caretColor),
    'rgba(0, 0, 0, 0)',
  )
  await source.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await cursor.waitFor({ state: 'hidden' })
  await source.press('ArrowRight')
  await cursor.waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await cursor.evaluate(
      (element) => getComputedStyle(element, '::after').animationName,
    ),
    'none',
  )
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].reload(),
    ),
  ])
  await rich.waitFor()
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'appearance', exact: true }).click()
  assert.equal(
    await page.getByLabel('cursor style', { exact: true }).inputValue(),
    'underline',
  )
  assert.equal(
    await page.getByLabel('cursor blink', { exact: true }).inputValue(),
    'normal',
  )
  assert.equal(
    await page.getByLabel('cursor animation', { exact: true }).inputValue(),
    'blink',
  )
})
