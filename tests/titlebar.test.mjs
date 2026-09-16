import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'

test('titlebar insets titles without leading actions and adapts outer button corners', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-titlebar-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page
    .getByRole('button', { name: 'rename document', exact: true })
    .click()
  const rename = page.getByRole('textbox', { name: 'file name', exact: true })
  assert.deepEqual(
    await rename.evaluate((input) => {
      const style = getComputedStyle(input)
      return { border: style.borderTopWidth, background: style.backgroundColor }
    }),
    { border: '0px', background: 'rgba(0, 0, 0, 0)' },
  )
  await rename.press('Escape')
  await page.getByRole('button', { name: 'editor settings' }).click()
  for (const category of ['hibi', 'appearance']) {
    await page.getByRole('tab', { name: category, exact: true }).click()
    await page.locator('.settings-content').evaluate((el) => el.scrollTo(0, 0))
    await page.evaluate(() => document.fonts.ready)
    const clip = { x: 220, y: 0, width: 500, height: 36 }
    const before = await page.screenshot({ clip, animations: 'disabled' })
    await page.locator('.settings-content').evaluate((el) => el.scrollTo(0, 60))
    await page.waitForFunction(
      () => document.querySelector('.settings-content').scrollTop === 60,
    )
    const after = await page.screenshot({ clip, animations: 'disabled' })
    assert.ok(
      before.equals(after),
      `${category}: scrolled content must not show through the titlebar`,
    )
  }
  const inset = await page
    .locator('.document-title')
    .evaluate(
      (element) =>
        element.getBoundingClientRect().left -
        element.parentElement.getBoundingClientRect().left,
    )
  assert.equal(inset, 16)
  await page.getByLabel('position', { exact: true }).selectOption('top-center')
  await page.getByLabel('dismiss after', { exact: true }).selectOption('3000')
  await page.getByRole('button', { name: 'show preview', exact: true }).click()
  await page.locator('.sonner[data-position="top-center"]').waitFor()
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('toast-preferences')),
    ),
    { position: 'top-center', duration: 3000 },
  )
  await page
    .getByRole('button', { name: 'dismiss notice', exact: true })
    .click()
  await page.getByRole('button', { name: 'back to editor' }).click()
  for (const open of [false, true]) {
    await page.getByRole('button', { name: 'toggle workspace sidebar' }).click()
    const surface = await page.locator('.editor-surface').evaluate((el) => {
      const styles = getComputedStyle(el, '::before')
      return {
        left: el.getBoundingClientRect().left + Number.parseFloat(styles.left),
        top: el.getBoundingClientRect().top + Number.parseFloat(styles.top),
        background: styles.backgroundColor,
        page: getComputedStyle(document.body).backgroundColor,
      }
    })
    assert.equal(surface.left, open ? 196 : 0)
    assert.equal(surface.top, 0)
    assert.equal(surface.background, surface.page)
  }
  for (const [platform, radius, rightPadding] of [
    ['darwin', '6px', '12px'],
    ['win32', '6px', '140px'],
    ['linux', '6px', '140px'],
  ]) {
    const actual = await page.evaluate((platform) => {
      document.querySelector('.app').setAttribute('data-platform', platform)
      const button = document.querySelector(
        platform === 'darwin'
          ? '.view-switch > button:last-child'
          : '.sidebar-toolbar > button:first-child',
      )
      const styles = getComputedStyle(button)
      return {
        radius:
          platform === 'darwin'
            ? styles.borderTopRightRadius
            : styles.borderTopLeftRadius,
        rightPadding: getComputedStyle(document.querySelector('.titlebar'))
          .paddingRight,
      }
    }, platform)
    assert.deepEqual(actual, { radius, rightPadding })
  }
})
