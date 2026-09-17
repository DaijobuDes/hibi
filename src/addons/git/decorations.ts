import type { ExplorerDecoration } from '../../shared/workspace'
import type { GitFile } from './types'

function status(file: GitFile) {
  const xy = file.index + file.worktree
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy))
    return {
      badge: '!',
      name: 'merge conflict',
      color: 'status-danger',
      rank: 5,
    } as const
  if (xy === '??')
    return {
      badge: 'U',
      name: 'untracked',
      color: 'status-success',
      rank: 1,
    } as const
  if (xy.includes('D'))
    return {
      badge: 'D',
      name: 'deleted',
      color: 'status-danger',
      rank: 4,
    } as const
  if (xy.includes('R'))
    return {
      badge: 'R',
      name: 'renamed',
      color: 'status-info',
      rank: 2.5,
    } as const
  if (xy.includes('A') || xy.includes('C'))
    return {
      badge: 'A',
      name: 'added',
      color: 'status-success',
      rank: 2,
    } as const
  return {
    badge: 'M',
    name: 'modified',
    color: 'status-warning',
    rank: 3,
  } as const
}

/** Parent folders remain marked even when changed files are collapsed or deleted. */
export function gitDecorations(
  files: readonly GitFile[],
): ExplorerDecoration[] {
  const folders = new Map<
    string,
    { count: number; status: ReturnType<typeof status> }
  >()
  const result: ExplorerDecoration[] = files.map((file) => {
    const state = status(file)
    const parents = new Set([''])
    for (const name of [file.path, file.original].filter(
      (path) => path !== undefined,
    )) {
      const parts = name.split('/')
      parts.pop()
      while (parts.length) {
        parents.add(parts.join('/'))
        parts.pop()
      }
    }
    for (const path of parents) {
      const previous = folders.get(path)
      folders.set(path, {
        count: (previous?.count ?? 0) + 1,
        status:
          previous && previous.status.rank > state.rank
            ? previous.status
            : state,
      })
    }
    const stage =
      file.index === '?' || state.badge === '!'
        ? ''
        : file.index === ' '
          ? 'unstaged'
          : file.worktree === ' '
            ? 'staged'
            : 'staged and unstaged'
    return {
      path: file.path,
      badge: state.badge,
      color: state.color,
      label: `Git: ${state.name}${file.original ? ` from ${file.original}` : ''}${stage ? ` (${stage})` : ''}`,
    }
  })
  for (const [path, folder] of folders)
    result.push({
      path,
      badge: '●',
      color: folder.status.color,
      label: `Git: contains ${folder.count} changed ${folder.count === 1 ? 'file' : 'files'}${folder.status.badge === '!' ? ', including merge conflicts' : ''}`,
    })
  return result
}
