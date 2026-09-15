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
  await page.getByRole('button', { name: 'side-by-side', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'markdown editor' })
  await source.waitFor()
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
  assert.equal(await source.isVisible(), false)
  await page.getByRole('button', { name: 'markdown only', exact: true }).click()
  assert.equal(await rich.isVisible(), false)
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
})
