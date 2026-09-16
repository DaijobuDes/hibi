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
  await page.getByRole('button', { name: 'editor settings' }).click()
  const inset = await page
    .locator('.document-title')
    .evaluate(
      (element) =>
        element.getBoundingClientRect().left -
        element.parentElement.getBoundingClientRect().left,
    )
  assert.equal(inset, 16)
  await page.getByRole('button', { name: 'back to editor' }).click()
  for (const [platform, radius, rightPadding] of [
    ['darwin', '10px', '12px'],
    ['win32', '8px', '140px'],
    ['linux', '0px', '140px'],
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
