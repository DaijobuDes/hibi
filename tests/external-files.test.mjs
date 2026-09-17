import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { externalFileArguments } from '../src/main/external-files.ts'
import { electron } from './electron.mjs'

test('launch arguments exclude flags, their values, executable, and URLs', () => {
  assert.deepEqual(
    externalFileArguments(
      [
        'electron',
        'app',
        '--user-data-dir',
        'profile.md',
        '--hibi-test',
        '--inspect=9229',
        'notes/a.md',
        'https://example.com/a.md',
        '--',
        '-b.txt',
      ],
      '/workspace',
      true,
    ),
    [resolve('/workspace/notes/a.md'), resolve('/workspace/-b.txt')],
  )
  assert.deepEqual(
    externalFileArguments(['hibi', 'a.md', 'a.md'], '/workspace', false),
    [resolve('/workspace/a.md')],
  )
  const file = resolve('notes with spaces.md')
  assert.deepEqual(
    externalFileArguments(
      [
        'hibi',
        '--no-sandbox',
        pathToFileURL(file).href,
        'file://remote/share/note.md',
      ],
      '/workspace',
      false,
    ),
    [file],
  )
})

test('OS file opens survive startup, reuse tabs, and preserve canceled drafts', {
  timeout: 30000,
}, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'hibi-open-with-'))
  const first = join(temp, 'first.md')
  const second = join(temp, 'second.txt')
  await writeFile(first, '# First')
  await writeFile(second, 'Second')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(temp, 'profile')}`, first],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(temp, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: 'first.md', exact: true }).waitFor()
  await app.evaluate(
    ({ app }, path) => app.emit('open-file', { preventDefault() {} }, path),
    second,
  )
  await page.getByRole('tab', { name: 'second.txt', exact: true }).waitFor()
  await app.evaluate(
    ({ app }, path) =>
      app.emit('second-instance', {}, ['electron', 'app', path], process.cwd()),
    first,
  )
  await page.waitForFunction(() =>
    document
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent?.includes('first.md'),
  )
  assert.equal(
    await page.getByRole('tab', { name: 'first.md', exact: true }).count(),
    1,
  )
  await page.evaluate(async () => {
    await window.hibi.setTabsEnabled(false)
    await window.hibi.updateDocument('Unsaved draft')
  })
  await app.evaluate(
    ({ app, dialog }, path) =>
      new Promise((resolve) => {
        dialog.showMessageBox = async () => {
          resolve(true)
          return { response: 2 }
        }
        app.emit('open-file', { preventDefault() {} }, path)
      }),
    second,
  )
  // A second drain waits for the first operation to finish, without a timing guess.
  await page.evaluate(() => window.hibi.openExternalDocuments())
  const draft = await page.evaluate(() => window.hibi.getDocument())
  assert.equal(draft.markdown, 'Unsaved draft')
  assert.equal(draft.name, 'first.md')
})
