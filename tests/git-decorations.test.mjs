import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { gitDecorations } from '../src/addons/git/decorations.ts'
import { explorerDecorations } from '../src/renderer/src/explorer-decorations.ts'

test('git markers cover staged, unstaged, new, renamed, deleted, and conflicting paths and parent folders', () => {
  const files = [
    ['guide/modified.md', ' ', 'M'],
    ['guide/staged.md', 'M', ' '],
    ['guide/added.md', 'A', 'M'],
    ['guide/new.md', '?', '?'],
    ['guide/removed.md', ' ', 'D'],
    ['guide/deep/conflict.md', 'U', 'U'],
    ['guide/renamed.md', 'R', ' '],
  ].map(([path, index, worktree]) => ({ path, index, worktree }))
  files.at(-1).original = 'previous/old.md'
  const result = new Map(gitDecorations(files).map((item) => [item.path, item]))
  assert.deepEqual(
    files.map((file) => result.get(file.path).badge),
    ['M', 'M', 'A', 'U', 'D', '!', 'R'],
  )
  assert.match(result.get('guide/staged.md').label, /\(staged\)/)
  assert.match(result.get('guide/added.md').label, /staged and unstaged/)
  assert.match(result.get('guide').label, /7 changed files.*merge conflicts/)
  assert.equal(result.get('guide').color, 'status-danger')
  assert.equal(result.get('guide/deep').badge, '●')
  assert.equal(result.get('previous').badge, '●')
  assert.match(result.get('').label, /7 changed files/)
  assert.deepEqual(gitDecorations([]), [])
})

test('explorer providers discard results from previous workspaces and disposed owners', async () => {
  const pending = []
  const wait = async (condition) => {
    const deadline = Date.now() + 2000
    while (!condition() && Date.now() < deadline) await delay(20)
    assert.ok(condition())
  }
  const workspace = (id) => ({
    id,
    name: 'same folder name',
    entries: [],
    activePath: null,
  })
  const remove = explorerDecorations.register('test.git', {
    id: 'git',
    provide: (workspace) =>
      new Promise((resolve) => pending.push({ workspace, resolve })),
  })
  try {
    explorerDecorations.setWorkspace(workspace('first'))
    await wait(() => pending.length === 1)
    explorerDecorations.setWorkspace(workspace('second'))
    pending[0].resolve([
      { path: 'same.md', label: 'wrong workspace', badge: 'M' },
    ])
    await wait(() => pending.length === 2)
    assert.equal(explorerDecorations.snapshot().size, 0)
    pending[1].resolve([
      { path: 'same.md', label: 'current workspace', badge: 'U' },
    ])
    await wait(
      () => explorerDecorations.snapshot().get('same.md')?.badge === 'U',
    )
    explorerDecorations.setWorkspace(workspace('second'))
    await wait(() => pending.length === 3)
    remove()
    pending[2].resolve([{ path: 'same.md', label: 'disposed', badge: 'M' }])
    await delay(20)
    assert.equal(explorerDecorations.snapshot().size, 0)
    const removeNew = explorerDecorations.register('test.git', {
      id: 'git',
      provide: async () => [{ path: 'new.md', label: 'new owner', badge: 'A' }],
    })
    remove()
    await wait(() => explorerDecorations.snapshot().has('new.md'))
    removeNew()
  } finally {
    remove()
    explorerDecorations.setWorkspace(null)
  }
})
