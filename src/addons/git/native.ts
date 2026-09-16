import { execFile } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { NativeAddon, NativeAddonContext } from '../api'
import manifest from './manifest'
import type { GitFile, GitState } from './types'

const execute = promisify(execFile)
const redact = (text: string) =>
  text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
async function repository(context: NativeAddonContext) {
  const cwd = context.workspace.directory()
  if (!cwd) throw new Error('open a git repository folder first.')
  const hooks = join(app.getPath('userData'), 'disabled-git-hooks')
  await mkdir(hooks, { recursive: true, mode: 0o700 })
  const config = [
    `core.hooksPath=${hooks}`,
    'core.fsmonitor=false',
    'core.pager=cat',
    'core.askPass=',
    'core.alternateRefsCommand=',
    'maintenance.auto=false',
    'gc.auto=0',
    'commit.gpgSign=false',
    'tag.gpgSign=false',
    'submodule.recurse=false',
    'fetch.recurseSubmodules=false',
    'protocol.allow=never',
    ...['http', 'https', 'ssh', 'file'].map(
      (name) => `protocol.${name}.allow=always`,
    ),
    'credential.helper=',
    ...(process.platform === 'darwin' ? ['credential.helper=osxkeychain'] : []),
  ].flatMap((setting) => ['-c', setting])
  const run = async (args: string[], optional = false): Promise<string> => {
    try {
      const result = await execute('git', [...config, ...args], {
        cwd,
        timeout: 90_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          GIT_PAGER: 'cat',
          GIT_LITERAL_PATHSPECS: '1',
          GIT_OPTIONAL_LOCKS: '0',
        },
      })
      return result.stdout
    } catch (error) {
      const failure = error as Error & {
        stderr?: string
        code?: number | string
        killed?: boolean
      }
      if (optional && failure.code === 1) return ''
      throw new Error(
        failure.killed
          ? 'git operation timed out.'
          : redact(failure.stderr?.trim() || failure.message),
      )
    }
  }
  // Config queries cannot run filters. Override executable repository settings
  // before asking Git to inspect or modify files.
  const executableKeys = await run(
    [
      'config',
      '--name-only',
      '--get-regexp',
      '^(filter[.].*[.](clean|smudge|process|required)|credential[.].*[.]helper|core[.]gitproxy|protocol[.].*[.]allow|remote[.].*[.]vcs)$',
    ],
    true,
  )
  for (const key of executableKeys.trim().split('\n').filter(Boolean))
    config.push(
      '-c',
      `${key}=${key.startsWith('protocol.') ? (/^protocol\.(http|https|ssh|file)\.allow$/.test(key) ? 'always' : 'never') : key.endsWith('.required') ? 'false' : ''}`,
    )
  const top = (await run(['rev-parse', '--show-toplevel'])).trim()
  if ((await realpath(top)) !== (await realpath(cwd)))
    throw new Error('open the repository root folder to use git.')
  const files = async (): Promise<GitFile[]> => {
    const records = (
      await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    ).split('\0')
    const result: GitFile[] = []
    for (let i = 0; i < records.length; i++) {
      const entry = records[i]
      if (!entry) continue
      const index = entry[0] ?? ' ',
        worktree = entry[1] ?? ' '
      const original = /[RC]/.test(index + worktree) ? records[++i] : undefined
      result.push({
        path: entry.slice(3),
        index,
        worktree,
        ...(original ? { original } : {}),
      })
    }
    return result
  }
  const branches = async () =>
    (
      await run([
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
        'refs/remotes',
      ])
    )
      .trim()
      .split('\n')
      .filter((ref) => ref && !ref.endsWith('/HEAD'))
  return { run, files, branches }
}
async function state(context: NativeAddonContext): Promise<GitState> {
  const repo = await repository(context)
  const branch =
    (await repo.run(['symbolic-ref', '--short', 'HEAD'], true)).trim() ||
    (await repo.run(['rev-parse', '--short', 'HEAD'])).trim()
  const counts = await repo
    .run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
    .catch(() => '')
  const [ahead = 0, behind = 0] = counts.trim().split(/\s+/).map(Number)
  return {
    branch,
    branches: await repo.branches(),
    files: await repo.files(),
    ahead,
    behind,
  }
}
async function changedPath(
  repo: Awaited<ReturnType<typeof repository>>,
  value: unknown,
) {
  if (typeof value !== 'string') throw new Error('choose a changed file.')
  const file = (await repo.files()).find((file) => file.path === value)
  if (!file)
    throw new Error('this file no longer has changes. refresh git status.')
  return file
}
export default {
  id: manifest.id,
  queries: {
    async decorations(_input, context) {
      const id = context.workspace.id()
      if (!id) return null
      try {
        const repo = await repository(context)
        return { id, files: await repo.files() }
      } catch {
        // Ordinary folders have no Git decorations. The panel reports errors on demand.
        return null
      }
    },
  },
  methods: {
    state: (_input, context) => state(context),
    async diff(input, context) {
      const repo = await repository(context)
      const file = await changedPath(repo, input)
      if (file.index === '?' && file.worktree === '?')
        return 'untracked file — stage it to preview its diff.'
      const paths = file.original ? [file.original, file.path] : [file.path]
      const base = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
      return (
        [
          await repo.run([...base, '--cached', '--', ...paths]),
          await repo.run([...base, '--', ...paths]),
        ]
          .filter(Boolean)
          .join('\n') || 'no text diff (binary file or metadata change).'
      )
    },
    async stage(input, context) {
      const repo = await repository(context)
      const file = await changedPath(repo, input)
      const filter = (
        await repo.run(['check-attr', '-z', 'filter', '--', file.path])
      ).split('\0')[2]
      if (filter && !['unspecified', 'unset'].includes(filter))
        throw new Error(
          'this file uses an external git filter. stage it with your git client to preserve its encoding.',
        )
      await repo.run([
        'add',
        '--',
        ...(file.original ? [file.original] : []),
        file.path,
      ])
      return state(context)
    },
    async unstage(input, context) {
      const repo = await repository(context)
      const file = await changedPath(repo, input)
      const head = await repo
        .run(['rev-parse', '--verify', 'HEAD'])
        .catch(() => '')
      await repo.run(
        head
          ? [
              'restore',
              '--staged',
              '--',
              ...(file.original ? [file.original] : []),
              file.path,
            ]
          : ['rm', '--cached', '--ignore-unmatch', '--', file.path],
      )
      return state(context)
    },
    async commit(input, context) {
      if (typeof input !== 'string' || !input.trim() || input.length > 8000)
        throw new Error('enter a commit message under 8,000 characters.')
      const repo = await repository(context)
      await repo.run(['commit', '--no-gpg-sign', '-m', input.trim()])
      return state(context)
    },
    async switch(input, context) {
      const repo = await repository(context)
      if (context.workspace.hasUnsavedChanges() || (await repo.files()).length)
        throw new Error(
          'save edits and commit or stash changes before switching branches.',
        )
      if (typeof input !== 'string' || !(await repo.branches()).includes(input))
        throw new Error('choose an existing branch.')
      await repo.run(
        input.startsWith('refs/remotes/')
          ? ['switch', '--track', input.slice('refs/remotes/'.length)]
          : ['switch', input.slice('refs/heads/'.length)],
      )
      await context.workspace.reload()
      return state(context)
    },
    async pull(_input, context) {
      const repo = await repository(context)
      if (context.workspace.hasUnsavedChanges() || (await repo.files()).length)
        throw new Error(
          'save edits and commit or stash changes before pulling.',
        )
      await repo.run([
        'pull',
        '--ff-only',
        '--no-rebase',
        '--no-recurse-submodules',
        '--upload-pack=git-upload-pack',
      ])
      await context.workspace.reload()
      return state(context)
    },
    async push(_input, context) {
      const repo = await repository(context)
      await repo.run([
        'push',
        '--receive-pack=git-receive-pack',
        '--no-recurse-submodules',
      ])
      return state(context)
    },
  },
} satisfies NativeAddon
