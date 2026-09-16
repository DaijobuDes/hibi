import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import { electron } from './electron.mjs'

test('shared dialogs validate input, trap focus, queue, and clean up by addon owner', {
  timeout: 45000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-dialogs-'))
  const bundle = join(folder, 'bundle')
  await build({
    configFile: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' },
    build: {
      outDir: bundle,
      lib: {
        entry: resolve('tests/fixtures/dialogs.tsx'),
        name: 'DialogHarness',
        formats: ['iife'],
        fileName: () => 'harness.js',
        cssFileName: 'harness',
      },
    },
  })
  const html = join(bundle, 'index.html')
  await writeFile(
    html,
    '<!doctype html><html lang="en"><head><link rel="stylesheet" href="harness.css"></head><body><script src="harness.js"></script></body></html>',
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`],
  })
  t.after(async () => {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  })
  await app.firstWindow()
  const next = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, path) => {
    const window = new BrowserWindow({
      width: 760,
      height: 560,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    void window.loadFile(path)
  }, html)
  const page = await next
  page.setDefaultTimeout(5000)
  await page.waitForFunction(() => Boolean(window.dialogTest))
  const prompt = page.getByRole('button', { name: 'open built-in prompt' })
  await prompt.click()
  const dialog = page.getByRole('dialog', { name: 'name this note' })
  const input = dialog.getByRole('textbox', { name: 'name', exact: true })
  await input.waitFor()
  assert.equal(
    await input.evaluate((element) => element === document.activeElement),
    true,
  )
  await input.fill('')
  await input.press('Enter')
  await dialog.getByRole('alert').filter({ hasText: 'enter a name.' }).waitFor()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    assert.equal(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('dialog')),
      ),
      true,
    )
  }
  await input.fill('  keep spacing  ')
  await input.press('Enter')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(
    await page.getByLabel('dialog result').textContent(),
    '"  keep spacing  "',
  )
  assert.equal(
    await prompt.evaluate((element) => element === document.activeElement),
    true,
  )
  await prompt.click()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByLabel('dialog result').innerText(), 'null')

  await page.getByRole('button', { name: 'open built-in confirm' }).click()
  await page
    .getByRole('dialog', { name: 'continue?' })
    .getByRole('button', { name: 'continue', exact: true })
    .click()
  await page.waitForFunction(
    () => document.querySelector('output').textContent === 'true',
  )
  await page.getByRole('button', { name: 'open built-in confirm' }).click()
  await page.mouse.click(4, 4)
  await page.waitForFunction(
    () => document.querySelector('output').textContent === 'false',
  )

  await page.evaluate(() => {
    const { owner, other, createElement } = window.dialogTest
    window.completedDialogs = []
    for (const [scope, title] of [
      [owner, 'active addon dialog'],
      [owner, 'queued addon dialog'],
      [other, 'other addon dialog'],
    ]) {
      const handle = scope.api.open({
        title,
        content: ({ close }) =>
          createElement(
            'button',
            { onClick: () => close({ value: 7 }) },
            'custom result',
          ),
      })
      handle.result.then((value) =>
        window.completedDialogs.push({ title, value }),
      )
    }
  })
  await page.getByRole('dialog', { name: 'active addon dialog' }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.evaluate(() => window.dialogTest.owner.dispose())
  const other = page.getByRole('dialog', { name: 'other addon dialog' })
  await other.waitFor()
  assert.deepEqual(await page.evaluate(() => window.completedDialogs), [
    { title: 'active addon dialog', value: null },
    { title: 'queued addon dialog', value: null },
  ])
  await mkdir('test-results', { recursive: true })
  await page.screenshot({
    path: 'test-results/addon-dialog.png',
    animations: 'disabled',
  })
  await other.getByRole('button', { name: 'custom result' }).click()
  await other.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.completedDialogs.at(-1)), {
    title: 'other addon dialog',
    value: { value: 7 },
  })
  assert.equal(
    await page.evaluate(() =>
      window.dialogTest.owner.api.confirm({ title: 'stopped addon' }),
    ),
    false,
  )

  await page.evaluate(() => {
    const { dialogs, createElement } = window.dialogTest
    window.handle = dialogs.open({
      title: 'keyboard custom',
      closeOnOutsideClick: false,
      content: () =>
        createElement(
          'button',
          {
            onClick: () => {
              window.customClicked = true
            },
          },
          'keep open',
        ),
    })
  })
  const custom = page.getByRole('dialog', { name: 'keyboard custom' })
  await custom.getByRole('button', { name: 'keep open' }).focus()
  await page.keyboard.press('Space')
  assert.equal(await page.evaluate(() => window.customClicked), true)
  assert.equal(await custom.isVisible(), true)
  await page.mouse.click(4, 4)
  assert.equal(await custom.isVisible(), true)
  await page.evaluate(() => window.handle.close('programmatic'))
  assert.equal(await page.evaluate(() => window.handle.result), 'programmatic')
  await page.evaluate(() => {
    window.handle = window.dialogTest.dialogs.open({
      title: 'broken content',
      content: () => {
        throw new Error('fixture failure')
      },
    })
  })
  const broken = page.getByRole('dialog', { name: 'broken content' })
  await broken.getByRole('alert').waitFor()
  await broken.getByRole('button', { name: 'close', exact: true }).click()
  assert.equal(await page.evaluate(() => window.handle.result), null)
  assert.equal(
    await page.evaluate(() => window.dialogTest.dialogs.isOpen()),
    false,
  )
})
