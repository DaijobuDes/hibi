import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'

test('settings search groups controls, discovers enabled plugins, and reveals filtered settings', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-settings-search-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await clickMenu(app, 'Settings')
  const search = page.getByRole('textbox', {
    name: 'Search settings',
    exact: true,
  })
  const result = (name) => page.getByRole('treeitem', { name, exact: true })
  const focused = (id) =>
    page.waitForFunction((id) => document.activeElement?.id === id, id)
  await search.fill('spelling')
  await result('Editor').waitFor()
  await result('Spell check').click()
  await focused('spell-check')
  assert.equal(
    await page
      .getByRole('tabpanel', { name: 'Editor', exact: true })
      .isVisible(),
    true,
  )
  await search.fill('properties by default')
  await result('Frontmatter').waitFor()
  await result('Expand properties by default').click()
  await focused('frontmatter-expanded')
  await search.fill('typst')
  assert.equal(await page.locator('#category-plugin-typst').count(), 0)
  await search.fill('zz-no-settings-zz')
  await page.getByText('No matching settings.', { exact: true }).waitFor()
  await search.press('Escape')
  assert.equal(await search.inputValue(), '')
  await page.getByRole('tab', { name: 'Formats', exact: true }).click()
  await page
    .getByRole('searchbox', { name: 'Filter formats', exact: true })
    .fill('not-a-format')
  await search.fill('plain text')
  await result('Plain text').click()
  await page.waitForFunction(() =>
    document.activeElement?.closest('[data-setting-id="format-text"]'),
  )
  assert.equal(
    await page
      .getByRole('searchbox', { name: 'Filter formats', exact: true })
      .inputValue(),
    '',
  )
  await search.fill('close tab')
  await search.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await focused('hotkey-close-tab')
  await search.fill('spelling')
  await page
    .getByRole('button', { name: 'Clear settings search', exact: true })
    .click()
  assert.equal(
    await search.evaluate((el) => document.activeElement === el),
    true,
  )
  await page.getByRole('tab', { name: 'Appearance', exact: true }).waitFor()
  await search.fill('spelling')
  await page.getByRole('button', { name: 'Back to app', exact: true }).click()
  await page.locator('.settings-screen').waitFor({ state: 'hidden' })
  await clickMenu(app, 'Settings')
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-label') === 'Search settings',
  )
  assert.equal(await search.inputValue(), 'spelling')
})
