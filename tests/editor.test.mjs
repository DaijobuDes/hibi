import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'

test('empty entry, three views, and lossless source switching', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-editor-'))
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
  const rich = page.getByRole('textbox', { name: 'document editor' })
  await rich.waitFor()
  assert.equal((await rich.innerText()).trim(), '')
  assert.equal(
    await rich.locator('p').getAttribute('data-placeholder'),
    'start typing',
  )
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-label') === 'document editor',
  )
  await rich.fill('hello editor')
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.titlebar')).opacity === '0',
  )
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.titlebar')).opacity === '1',
  )
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
  const geometry = await page.evaluate(() => {
    const panes = document
      .querySelector('.editor-panes')
      .getBoundingClientRect()
    const title = document
      .querySelector('.document-title')
      .getBoundingClientRect()
    return {
      top: panes.top,
      bottom: panes.bottom,
      viewport: innerHeight,
      padding: getComputedStyle(document.querySelector('.tiptap')).paddingTop,
      centered: Math.abs(title.x + title.width / 2 - innerWidth / 2) < 0.5,
      flat:
        getComputedStyle(document.querySelector('.titlebar'))
          .borderBottomWidth === '0px' &&
        getComputedStyle(document.querySelector('.document-title'))
          .borderWidth === '0px',
    }
  })
  assert.equal(geometry.top, 36)
  assert.equal(geometry.bottom, geometry.viewport)
  assert.equal(geometry.padding, '48px')
  assert.equal(geometry.centered, true)
  assert.equal(geometry.flat, true)
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('main', { name: 'settings' }).waitFor()
  assert.equal(await rich.isVisible(), false)
  await page.getByRole('tab', { name: 'appearance', exact: true }).click()
  await page
    .getByRole('checkbox', { name: 'hide top bar while typing' })
    .uncheck()
  await page.getByRole('tab', { name: 'editor', exact: true }).click()
  await page.getByRole('slider', { name: 'content padding' }).press('Home')
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.tiptap')).paddingTop,
    ),
    '0px',
  )
  await page.keyboard.press('Escape')
  assert.equal(await source.innerText(), 'hello editor')
  const markdown =
    '# hello\n\n**bold** text\n\n- [x] done\n\n| name | value |\n| --- | --- |\n| one | two |'
  await source.fill(markdown)
  await rich.getByRole('heading', { name: 'hello', exact: true }).waitFor()
  assert.equal(await rich.locator('strong').innerText(), 'bold')
  assert.equal(await rich.getByRole('checkbox').isChecked(), true)
  assert.equal(
    await rich.getByRole('cell', { name: 'two', exact: true }).innerText(),
    'two',
  )
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  await source.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  await rich.waitFor({ state: 'hidden' })
  assert.equal(
    (await source.locator('.cm-line').allTextContents()).join('\n'),
    markdown,
  )
  const extended =
    '---\ntitle: keep me\n---\n\n<div data-value="keep">custom html</div>\n'
  await source.fill(extended)
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  assert.equal(await rich.getAttribute('contenteditable'), 'false')
  assert.equal(
    (await source.locator('.cm-line').allTextContents()).join('\n'),
    extended,
  )
  await page.reload()
  await rich.waitFor()
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'appearance', exact: true }).click()
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'hide top bar while typing' })
      .isChecked(),
    false,
  )
  await page
    .getByRole('tab', { name: 'appearance', exact: true })
    .press('ArrowUp')
  await page
    .getByRole('tab', { name: 'editor', exact: true, selected: true })
    .waitFor()
  assert.equal(
    await page
      .getByRole('tab', { name: 'editor', exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  await page.keyboard.press('Escape')
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.tiptap')).paddingTop,
    ),
    '0px',
  )
})
