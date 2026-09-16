import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { electron } from './electron.mjs'
import { pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

const execute = promisify(execFile)
test('git addon stages, commits, switches, pulls and pushes only to a disposable local remote', {
  timeout: 60000,
}, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'hibi-git-'))
  const root = join(temp, 'workspace'),
    remote = join(temp, 'remote.git'),
    peer = join(temp, 'peer')
  const git = async (cwd, ...args) =>
    (
      await execute(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgSign=false',
          ...args,
        ],
        { cwd },
      )
    ).stdout.trim()
  await git(temp, 'init', '--bare', remote)
  await git(temp, 'init', '-b', 'main', root)
  await git(root, 'config', 'user.name', 'hibi test')
  await git(root, 'config', 'user.email', 'hibi@example.test')
  await writeFile(join(root, 'note.md'), 'initial')
  await git(root, 'add', 'note.md')
  await git(root, 'commit', '-m', 'initial')
  await git(root, 'remote', 'add', 'origin', remote)
  await git(root, 'push', '-u', 'origin', 'main')
  await git(root, 'branch', 'other')
  await git(temp, 'clone', '-b', 'main', remote, peer)
  await git(peer, 'config', 'user.name', 'hibi peer')
  await git(peer, 'config', 'user.email', 'peer@example.test')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(temp, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(temp, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async (_window, options) => ({
      canceled: false,
      filePaths: [
        options.properties.includes('openDirectory') ? root : `${root}/note.md`,
      ],
    })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, root)
  const page = await app.firstWindow()
  page.setDefaultTimeout(7000)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await pressShortcut(app, `${mod}+Shift+o`)
  await page.getByRole('button', { name: 'new workspace file' }).waitFor()
  await pressShortcut(app, `${mod}+o`)
  await page.waitForFunction(
    () => document.querySelector('.tiptap')?.textContent === 'initial',
  )
  await page.getByRole('button', { name: 'editor settings' }).click()
  await page.getByRole('tab', { name: 'addons', exact: true }).click()
  await page.locator('#addon-git').click()
  await page.waitForFunction(() => document.querySelector('#addon-git').checked)
  await page.getByRole('button', { name: 'back to editor' }).click()
  const invoke = (method, input) =>
    page.evaluate(
      ({ method, input }) => window.hibi.invokeAddon('git', method, input),
      { method, input },
    )
  assert.equal((await invoke('state')).branch, 'main')
  await writeFile(join(root, 'note.md'), 'local change')
  const hook = join(root, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, '#!/bin/sh\ntouch hook-ran\n')
  await chmod(hook, 0o755)
  await git(root, 'config', 'core.fsmonitor', 'touch fsmonitor-ran')
  await git(root, 'config', 'diff.external', 'touch diff-ran')
  assert.match(await invoke('diff', 'note.md'), /\+local change/)
  await invoke('stage', 'note.md')
  assert.equal((await invoke('state')).files[0].index, 'M')
  await invoke('unstage', 'note.md')
  assert.equal((await invoke('state')).files[0].worktree, 'M')
  await invoke('stage', 'note.md')
  await page.getByRole('button', { name: 'git', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'git', exact: true })
  await panel.getByLabel('commit staged changes').fill('local commit')
  await panel.getByRole('button', { name: 'commit', exact: true }).click()
  await panel.getByText('working tree clean.').waitFor()
  await panel.getByRole('button', { name: /^push/ }).click()
  await waitForAsync(
    page,
    async () => (await window.hibi.invokeAddon('git', 'state')).ahead === 0,
  ).catch(async () => {
    // The native operation lock may still be held while push is finishing.
    await panel
      .getByText('working…', { exact: true })
      .waitFor({ state: 'hidden' })
    assert.equal((await invoke('state')).ahead, 0)
  })
  assert.equal(
    await git(remote, 'log', '-1', '--format=%s', 'main'),
    'local commit',
  )
  await panel.getByLabel('git branch').selectOption('refs/heads/other')
  await panel
    .getByText('working…', { exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal((await invoke('state')).branch, 'other')
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'initial',
  )
  await panel.getByLabel('git branch').selectOption('refs/heads/main')
  await panel
    .getByText('working…', { exact: true })
    .waitFor({ state: 'hidden' })
  await git(peer, 'pull', '--ff-only')
  await writeFile(join(peer, 'note.md'), 'remote change')
  await git(peer, 'add', 'note.md')
  await git(peer, 'commit', '-m', 'remote change')
  await git(peer, 'push')
  await panel.getByRole('button', { name: /^pull/ }).click()
  await panel
    .getByText('working…', { exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), 'remote change')
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'remote change',
  )
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  await page
    .getByRole('textbox', { name: 'document editor' })
    .fill('unsaved edits')
  await assert.rejects(invoke('switch', 'refs/heads/other'), /save edits/)
  await assert.rejects(invoke('pull'), /save edits/)
  await assert.rejects(
    invoke('stage', '../outside.md'),
    /no longer has changes/,
  )
  await writeFile(join(root, '.gitattributes'), 'secret.md filter=secret\n')
  await writeFile(join(root, 'secret.md'), 'private text')
  await git(root, 'config', 'filter.secret.clean', 'touch filter-ran')
  await assert.rejects(invoke('stage', 'secret.md'), /external git filter/)
  await git(root, 'config', 'protocol.ext.allow', 'always')
  await git(
    root,
    'remote',
    'set-url',
    'origin',
    'ext::sh -c touch% remote-helper-ran',
  )
  await assert.rejects(invoke('push'), /not allowed/)
  for (const file of [
    'hook-ran',
    'fsmonitor-ran',
    'diff-ran',
    'filter-ran',
    'remote-helper-ran',
  ])
    await assert.rejects(access(join(root, file)))
})
