import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'

test('plugin pages, metadata, shared controls, and full source vim editing', {
  timeout: 60000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-vim-'))
  const fixture = join(folder, 'note.md')
  const initial = 'alpha beta gamma\nsecond line\nthird line'
  await writeFile(fixture, initial)
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(folder, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [fixture],
    })
  }, fixture)
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page.getByRole('button', { name: 'open', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.tiptap')?.textContent.includes('alpha'),
  )
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
  const read = async () =>
    (await page.evaluate(() => window.hibi.getDocument())).markdown
  const toggleAddon = async (id, enabled) => {
    const checkbox = page.locator(`#addon-${id}`)
    if ((await checkbox.isChecked()) !== enabled) await checkbox.click()
    await page.waitForFunction(
      ({ id, enabled }) =>
        document.querySelector(`#addon-${id}`).checked === enabled,
      { id, enabled },
    )
  }
  await page.getByRole('button', { name: 'editor settings' }).click()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({
    path: 'test-results/settings-buttons.png',
    animations: 'disabled',
  })
  assert.equal(
    await page
      .getByRole('button', { name: 'reset to 48 px' })
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    '1px',
  )
  await page.getByRole('tab', { name: 'appearance', exact: true }).click()
  await page.screenshot({
    path: 'test-results/settings-chevron.png',
    animations: 'disabled',
  })
  assert.equal(
    await page
      .getByRole('combobox', { name: 'cursor style' })
      .evaluate((el) => getComputedStyle(el).appearance),
    'none',
  )
  assert.equal(
    await page.locator('#settings-appearance .select-control > svg').count(),
    3,
  )
  const footer = await page.locator('.settings-versions').evaluate((el) => ({
    bottom: el.getBoundingClientRect().bottom,
    height: innerHeight,
    text: el.textContent,
  }))
  assert.ok(footer.bottom > footer.height - 80)
  assert.match(footer.text, /hibi 0\.1\.0.*electron 44\.3\.0/)
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  assert.equal(
    await page
      .locator('#settings-addons [data-discord-id="1262793452236570667"]')
      .count(),
    3,
  )
  await toggleAddon('frontmatter', false)
  assert.equal(
    await page.locator('.settings-sidebar .sidebar-section').count(),
    0,
  )
  await toggleAddon('vim', true)
  assert.equal(
    await page.locator('style[data-addon-style="vim.editor"]').count(),
    1,
  )
  await page.getByRole('tab', { name: 'vim', exact: true }).click()
  await page.waitForFunction(() => {
    const selected = document.querySelector(
      '.settings-sidebar [aria-selected="true"]',
    )
    const marker = document.querySelector(
      '.settings-sidebar .sidebar-selection',
    )
    return (
      Math.abs(
        selected.getBoundingClientRect().top -
          marker.getBoundingClientRect().top,
      ) < 1
    )
  })
  assert.equal(
    await page.locator('.settings-sidebar .sidebar-section').innerText(),
    'plugins',
  )
  await page.getByRole('checkbox', { name: 'show vim status' }).uncheck()
  await page.getByRole('checkbox', { name: 'show vim status' }).check()
  await page.getByRole('button', { name: 'back to editor' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-vim-plugin="true"]') ||
      document.querySelector('.error-message')?.textContent,
  )
  assert.equal(await page.locator('.error-message').innerText(), '')
  await page.getByRole('status').filter({ hasText: 'vim · normal' }).waitFor()
  const statusBounds = await page
    .locator('.app-statusbar')
    .evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      bottom: element.getBoundingClientRect().bottom,
      height: innerHeight,
    }))
  assert.equal(statusBounds.left, 0)
  assert.equal(statusBounds.bottom, statusBounds.height)
  assert.equal(await read(), initial)
  await source.press('Escape')
  await source.pressSequentially('gg0dw')
  assert.match(await read(), /^beta gamma/)
  await source.press('u')
  assert.equal(await read(), initial)
  await source.press('Control+r')
  assert.match(await read(), /^beta gamma/)
  await source.press('u')
  await source.pressSequentially('gg0"ayyGp')
  assert.equal((await read()).match(/alpha beta gamma/g).length, 2)
  await source.press('u')
  await source.pressSequentially('gg0ciw')
  await page.getByRole('status').filter({ hasText: 'vim · insert' }).waitFor()
  await page.keyboard.type('omega')
  await page.keyboard.press('Escape')
  await source.pressSequentially('w.')
  assert.match(await read(), /^omega omega gamma/)
  const ex = async (command) => {
    await source.pressSequentially(':')
    const input = page.locator('.cm-vim-panel input')
    await input.fill(command)
    await input.press('Enter')
  }
  await ex('%s/omega/alpha/g')
  assert.match(await read(), /^alpha alpha gamma/)
  await source.pressSequentially('gg0qaA')
  await page.keyboard.type('!')
  await page.keyboard.press('Escape')
  await source.pressSequentially('qj@a')
  assert.match(await read(), /second line!/)
  await source.pressSequentially('gg0vww')
  await page.getByRole('status').filter({ hasText: 'vim · visual' }).waitFor()
  await page
    .locator('.cm-selectionBackground')
    .first()
    .waitFor({ state: 'attached' })
  await source.press('Escape')
  const beforeSearch = await read()
  await source.press('/')
  await page.locator('.cm-vim-panel input').fill('second')
  await page.locator('.cm-vim-panel input').press('Enter')
  assert.equal(await read(), beforeSearch)
  await ex('w')
  await page
    .getByRole('status', { name: 'unsaved changes' })
    .waitFor({ state: 'hidden' })
  assert.equal(await readFile(fixture, 'utf8'), await read())
  await page.mouse.move(450, 18)
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.titlebar')).opacity === '1',
  )
  await page.screenshot({
    path: 'test-results/vim-status.png',
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  await toggleAddon('vim', false)
  assert.equal(
    await page.locator('style[data-addon-style="vim.editor"]').count(),
    0,
  )
  assert.equal(
    await page.locator('.settings-sidebar .sidebar-section').count(),
    0,
  )
  await page.getByRole('button', { name: 'back to editor' }).click()
  await page.waitForFunction(() => !document.querySelector('[data-vim-plugin]'))
  assert.equal(await page.locator('.app-statusbar').count(), 0)
  const beforePlain = await read()
  await source.press('End')
  await source.pressSequentially(' plain')
  assert.ok((await read()).includes(' plain'))
  await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  assert.equal(await read(), beforePlain)
  assert.deepEqual(errors, [])
})
