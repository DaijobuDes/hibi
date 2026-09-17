import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

test('non-input focus outlines default off across portals, preserve fields, and persist', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-focus-outlines-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  const settings = async () => {
    await clickMenu(app, 'Settings')
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  }
  await settings()
  const toggle = page.getByRole('checkbox', {
    name: 'Non-input focus outlines',
    exact: true,
  })
  assert.equal(await toggle.isChecked(), false)
  await page.evaluate(() => {
    const portal = document.createElement('div')
    portal.id = 'focus-probe'
    portal.innerHTML =
      '<button id="focus-button">Addon action</button><input id="focus-input" aria-label="Addon field">'
    document.body.append(portal)
  })
  await page.keyboard.press('Tab')
  const button = page.locator('#focus-button')
  const input = page.locator('#focus-input')
  await button.focus()
  assert.equal(
    await button.evaluate((el) => el.matches(':focus-visible')),
    true,
  )
  assert.equal(
    await button.evaluate((el) => getComputedStyle(el).outlineStyle),
    'none',
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#focus-button'))
        .backgroundColor !== 'rgba(0, 0, 0, 0)',
  )
  await input.focus()
  assert.equal(
    await input.evaluate((el) => getComputedStyle(el).outlineWidth),
    '2px',
  )
  await toggle.check()
  await page.keyboard.press('Tab')
  await button.focus()
  assert.equal(
    await button.evaluate((el) => getComputedStyle(el).outlineWidth),
    '2px',
  )
  await page.reload()
  await settings()
  assert.equal(await toggle.isChecked(), true)
  await toggle.uncheck()
  const category = page.getByRole('tab', { name: 'Appearance', exact: true })
  await page.keyboard.press('Tab')
  await category.focus()
  assert.equal(
    await category.evaluate((el) => getComputedStyle(el).outlineStyle),
    'none',
  )
})
