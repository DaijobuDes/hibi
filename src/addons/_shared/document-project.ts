import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { NativeAddonContext } from '../api'

const ignored = new Set([
  'node_modules',
  'target',
  'out',
  'dist',
  'build',
  'release',
])
export const withinProject = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** Bounded, regular-file snapshot shared by native document compilers. */
export async function documentProject(
  context: NativeAddonContext,
  options: {
    id?: string | undefined
    entry: string
    allowed: RegExp
    previousKey?: string
    paths?: readonly string[]
    canceled?: () => boolean
  },
) {
  const note = await context.document.path(options.id)
  const workspace = context.workspace.directory()
  const root = note
    ? workspace && withinProject(workspace, note)
      ? workspace
      : dirname(note)
    : null
  const entry = root && note ? relative(root, note) : options.entry
  const paths: {
    path: string
    name: string
    size: number
    modified: number
    changed: number
  }[] = []
  let bytes = 0,
    examined = 0
  const check = () => {
    if (options.canceled?.()) throw new Error('Document compilation canceled.')
  }
  async function walk(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      check()
      if (++examined > 10000)
        throw new Error('Project is too large. Open a smaller workspace.')
      if (
        item.name.startsWith('.') ||
        ignored.has(item.name) ||
        item.isSymbolicLink()
      )
        continue
      const path = `${directory}${sep}${item.name}`
      if ((await realpath(path)) !== path) continue
      if (item.isDirectory()) await walk(path)
      else if (item.isFile() && options.allowed.test(item.name)) {
        const info = await lstat(path)
        if (info.isSymbolicLink()) continue
        bytes += info.size
        if (paths.length >= 1000 || bytes > 64 * 1024 * 1024)
          throw new Error(
            'Projects support up to 1,000 input files and 64 MiB. Open a smaller workspace.',
          )
        paths.push({
          path,
          name: relative(root!, path),
          size: info.size,
          modified: info.mtimeMs,
          changed: info.ctimeMs,
        })
      }
    }
  }
  if (root && options.paths) {
    for (const name of options.paths) {
      check()
      const path = resolve(root, name)
      if (
        !withinProject(root, path) ||
        !options.allowed.test(name) ||
        name
          .split(/[\\/]/)
          .some((part) => part.startsWith('.') && part !== '..' && part !== '.')
      )
        continue
      try {
        const info = await lstat(path)
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          (await realpath(path)) !== path
        )
          continue
        bytes += info.size
        if (paths.length >= 1000 || bytes > 64 * 1024 * 1024)
          throw new Error('Document dependencies exceed 1,000 files or 64 MiB.')
        paths.push({
          path,
          name: relative(root, path),
          size: info.size,
          modified: info.mtimeMs,
          changed: info.ctimeMs,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  } else if (root) await walk(root)
  const key = createHash('sha256')
    .update(JSON.stringify([root, paths]))
    .digest('hex')
  if (key === options.previousKey) return { root, entry, key }
  const files: [string, Uint8Array][] = []
  for (const item of paths) {
    check()
    const file = await open(
      item.path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    )
    try {
      const info = await file.stat()
      if (
        !info.isFile() ||
        info.size !== item.size ||
        (await realpath(item.path)) !== item.path
      )
        throw new Error('Project input changed; try again.')
      const data = Buffer.alloc(item.size + 1)
      const { bytesRead } = await file.read(data, 0, data.length, 0)
      if (bytesRead !== item.size)
        throw new Error('Project input changed; try again.')
      files.push([item.name, data.subarray(0, bytesRead)])
    } finally {
      await file.close()
    }
  }
  return { root, entry, key, files }
}
