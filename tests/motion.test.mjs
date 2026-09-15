import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'

test('panes move horizontally and sidebar selection slides without fading settings', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-motion-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
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
  async function sampleSplit(from) {
    await page.getByRole('button', { name: from, exact: true }).click()
    await settle()
    return page.evaluate(async () => {
      const sample = () => {
        const rich = document
          .querySelector('.rich-pane')
          .getBoundingClientRect()
        const source = document
          .querySelector('.source-pane')
          .getBoundingClientRect()
        return {
          richX: rich.x,
          richWidth: rich.width,
          sourceX: source.x,
          sourceWidth: source.width,
        }
      }
      const samples = [sample()]
      document.querySelector('button[aria-label="side-by-side"]').click()
      const start = performance.now()
      while (performance.now() - start < 300) {
        await new Promise(requestAnimationFrame)
        samples.push(sample())
      }
      return samples
    })
  }
  const fromRich = await sampleSplit('normal')
  assert.equal(fromRich[0].sourceWidth, 0)
  assert.ok(
    fromRich.some((frame) => frame.sourceWidth > 0 && frame.sourceWidth < 490),
  )
  assert.equal(fromRich.at(-1).sourceX, 0)
  assert.equal(fromRich.at(-1).richX, 500)
  const fromSource = await sampleSplit('markdown only')
  assert.equal(fromSource[0].richWidth, 0)
  assert.ok(fromSource.some((frame) => frame.richX > 510 && frame.richX < 1000))
  assert.equal(fromSource.at(-1).richX, 500)
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
