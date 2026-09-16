import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { typingSpeed } from '../src/addons/typing-speed/speed.ts'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('typing speed expires samples at the rolling minute boundary', () => {
  const speed = typingSpeed()
  speed.add(5, 0)
  speed.add(15, 1000)
  assert.deepEqual(speed.read(59999), { cpm: 20, wpm: 4 })
  assert.deepEqual(speed.read(60000), { cpm: 15, wpm: 3 })
  assert.deepEqual(speed.read(61000), { cpm: 0, wpm: 0 })
})

test('typing pills, source formatting shortcuts, and sidebar shortcut', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-typing-'))
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
  page.setDefaultTimeout(6000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  await page.locator('#addon-typing-speed').click()
  await page.getByRole('button', { name: 'back to editor' }).click()
  await page
    .getByRole('textbox', { name: 'document editor' })
    .pressSequentially('hello')
  await page.getByText('5 cpm', { exact: true }).waitFor()
  await page.getByText('1 wpm', { exact: true }).waitFor()
  await pressShortcut(app, `${mod}+Shift+]`)
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.press(`${mod}+a`)
  await pressShortcut(app, `${mod}+b`)
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown === '**hello**',
  )
  await page.getByText('5 cpm', { exact: true }).waitFor()
  await pressShortcut(app, `${mod}+Shift+\\`)
  await source.focus()
  await pressShortcut(app, `${mod}+i`)
  await waitForAsync(
    page,
    async () => (await window.hibi.getDocument()).markdown === '***hello***',
  )
  await source.press('ArrowRight')
  await source.pressSequentially('!')
  await page.getByText('6 cpm', { exact: true }).waitFor()
  const before = await page.locator('.app').getAttribute('data-sidebar')
  await pressShortcut(app, `${mod}+/`)
  await page.waitForFunction(
    (before) => document.querySelector('.app').dataset.sidebar !== before,
    before,
  )
  await pressShortcut(app, `${mod}+k`)
  await page.getByRole('combobox').fill('typing')
  await page.getByText('6 cpm', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page
    .getByRole('dialog', { name: 'command palette' })
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.locator('#addon-typing-speed').click()
  assert.equal(await page.getByText('6 cpm', { exact: true }).count(), 0)
})
