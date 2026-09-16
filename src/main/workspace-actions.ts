import { constants } from 'node:fs'
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  rename,
  unlink,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path'
import { type BrowserWindow, shell } from 'electron'
import type { WorkspaceActionResult } from '../shared/workspace'
import {
  clearDocument,
  confirmDiscard,
  getDocument,
  getDocumentPath,
  newPendingDocument,
  relocateDocument,
  renameDocument,
} from './document'
import { refreshWorkspace, workspaceRoot } from './workspace'

const missing = (error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error
  return null
}
export function validateWorkspaceName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !name ||
    name.startsWith('.') ||
    name === 'node_modules' ||
    /[\\/<>:"|?*]|\p{Cc}/u.test(name) ||
    /[. ]$/.test(name) ||
    Buffer.byteLength(name) > 255 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('choose a valid file or folder name.')
}
async function resolveEntry(
  base: string,
  value: unknown,
  allowMissing = false,
  allowRoot = false,
): Promise<string> {
  if (allowRoot && value === '') return base
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    isAbsolute(value)
  )
    throw new Error('invalid workspace path.')
  const parts = value.split('/')
  let path = base
  for (const [index, part] of parts.entries()) {
    validateWorkspaceName(part)
    path = join(path, part)
    const stat = await lstat(path).catch(missing)
    if (!stat && allowMissing && index === parts.length - 1) return path
    if (
      !stat ||
      stat.isSymbolicLink() ||
      (index < parts.length - 1 && !stat.isDirectory())
    )
      throw new Error('workspace path is missing or contains a symlink.')
  }
  return path
}
function contains(parent: string, child: string | null) {
  if (!child) return false
  const path = relative(parent, child)
  return (
    !path ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}
async function unique(parent: string, name: string) {
  const extension = extname(name),
    stem = extension ? name.slice(0, -extension.length) : name
  for (let index = 0; index < 10000; index++) {
    const candidate = join(
      parent,
      `${stem}${index ? ` ${index + 1}` : ''}${extension}`,
    )
    if (!(await lstat(candidate).catch(missing))) return candidate
  }
  throw new Error('choose a different name.')
}
async function moveEntry(source: string, destination: string, folder: boolean) {
  if (folder) {
    // Reserve the destination first: never replace a pre-existing directory.
    await mkdir(destination)
    try {
      await rename(source, destination)
    } catch (error) {
      await import('node:fs/promises')
        .then(({ rmdir }) => rmdir(destination))
        .catch(() => {})
      throw error
    }
  } else {
    try {
      await link(source, destination)
    } catch (error) {
      if (
        !['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error
      await copyFile(source, destination, constants.COPYFILE_EXCL)
    }
    try {
      await unlink(source)
    } catch (error) {
      await unlink(destination)
      throw error
    }
  }
}
export async function workspaceAction(
  window: BrowserWindow,
  input: unknown,
): Promise<WorkspaceActionResult | null> {
  const base = workspaceRoot()
  if (!base) throw new Error('open a workspace first.')
  if (!input || typeof input !== 'object')
    throw new Error('invalid workspace action.')
  const { action, path, destination } = input as Record<string, unknown>
  if (
    ![
      'new-file',
      'new-folder',
      'rename',
      'copy',
      'move',
      'duplicate',
      'delete',
    ].includes(String(action))
  )
    throw new Error('unknown workspace action.')
  let resultPath: string
  if (action === 'new-file' || action === 'new-folder') {
    const parent = await resolveEntry(base, path, false, true)
    if (!(await lstat(parent)).isDirectory())
      throw new Error('choose a parent folder.')
    resultPath = await unique(
      parent,
      action === 'new-file' ? 'untitled.md' : 'untitled folder',
    )
    if (action === 'new-folder') await mkdir(resultPath)
    else if (!(await newPendingDocument(window, resultPath))) return null
  } else {
    const draft =
      getDocument().ephemeral &&
      typeof path === 'string' &&
      getDocumentPath() === join(base, path)
    const source = await resolveEntry(base, path, draft)
    const folder = draft ? false : (await lstat(source)).isDirectory()
    if (!folder && !/\.(md|markdown)$/i.test(source))
      throw new Error('choose a markdown file.')
    if (action === 'delete') {
      if (
        contains(source, getDocumentPath()) &&
        !(await confirmDiscard(window))
      )
        return null
      if (await lstat(source).catch(missing)) await shell.trashItem(source)
      if (contains(source, getDocumentPath())) clearDocument(window)
      resultPath = source
    } else {
      if (action === 'rename') {
        validateWorkspaceName(destination)
        let name = destination
        if (!folder && !extname(name)) name += '.md'
        resultPath = join(dirname(source), name)
      } else if (action === 'duplicate') {
        const extension = folder ? '' : extname(source)
        const name = basename(source, extension)
        resultPath = await unique(dirname(source), `${name} copy${extension}`)
      } else resultPath = await resolveEntry(base, destination, true)
      if (!folder && !/\.(md|markdown)$/i.test(resultPath))
        throw new Error('choose a markdown file name.')
      if (source === resultPath)
        return {
          workspace: await refreshWorkspace(),
          document: getDocument(),
          path: relative(base, source).split(sep).join('/'),
        }
      if (contains(source, resultPath))
        throw new Error('a folder cannot be placed inside itself.')
      if (await lstat(resultPath).catch(missing))
        throw new Error('an item already exists at that destination.')
      if (draft) {
        if (action === 'rename') await renameDocument(basename(resultPath))
        else if (action === 'move') relocateDocument(source, resultPath)
        else throw new Error('save this draft before copying it.')
      } else if (action === 'copy' || action === 'duplicate') {
        await cp(source, resultPath, {
          recursive: folder,
          force: false,
          errorOnExist: true,
          filter: async (path) => {
            if ((await lstat(path)).isSymbolicLink())
              throw new Error('copying symlinks is not supported.')
            return true
          },
        })
      } else {
        await moveEntry(source, resultPath, folder)
        relocateDocument(source, resultPath)
      }
    }
  }
  return {
    workspace: await refreshWorkspace(),
    document: getDocument(),
    path: relative(base, resultPath).split(sep).join('/'),
  }
}
