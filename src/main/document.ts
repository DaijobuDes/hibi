import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { type BrowserWindow, dialog } from 'electron'
import type { DocumentState } from '../shared/desktop'
import { readMarkdown, validateMarkdown, writeMarkdown } from './files'

let markdown = ''
let saved = ''
let path: string | null = null
let revision = 0
let untitledName = 'untitled.md'

export function getDocumentPath(): string | null {
  return path
}

export function getDocument(): DocumentState {
  return {
    markdown,
    savedMarkdown: saved,
    name: path ? basename(path) : untitledName,
    dirty: markdown !== saved,
    revision,
  }
}

export function discardChanges(): void {
  markdown = saved
  revision += 1
}

export function updateDocument(value: unknown): void {
  validateMarkdown(value)
  markdown = value
}

export async function saveDocument(
  window: BrowserWindow,
  saveAs = false,
  defaultPath?: string,
): Promise<DocumentState | null> {
  let destination = path
  const content = markdown
  if (!destination || saveAs) {
    const result = await dialog.showSaveDialog(window, {
      defaultPath: destination ?? defaultPath ?? untitledName,
      filters: [{ name: 'markdown', extensions: ['md', 'markdown', 'txt'] }],
    })
    if (result.canceled || !result.filePath) return null
    destination = result.filePath
  }
  destination = await realpath(destination).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return destination as string
    },
  )
  if (destination === path) {
    const disk = await readMarkdown(destination).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return null
      },
    )
    if (disk !== saved) {
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        message: 'this file changed outside hibi.',
        detail: 'replace the file with your current document?',
        buttons: ['replace', 'cancel'],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice.response !== 0) return null
    }
  }
  await writeMarkdown(destination, content)
  path = destination
  saved = content
  window.setDocumentEdited(markdown !== saved)
  return getDocument()
}

export async function confirmDiscard(window: BrowserWindow): Promise<boolean> {
  if (markdown === saved) return true
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    message: `save changes to ${getDocument().name}?`,
    detail: 'your changes will be lost if you do not save them.',
    buttons: ['save', 'don’t save', 'cancel'],
    defaultId: 0,
    cancelId: 2,
  })
  if (result.response === 2) return false
  if (result.response === 1) return true
  return Boolean(await saveDocument(window)) && markdown === saved
}

export async function newDocument(
  window: BrowserWindow,
): Promise<DocumentState | null> {
  if (!(await confirmDiscard(window))) return null
  markdown = saved = ''
  path = null
  untitledName = 'untitled.md'
  revision += 1
  window.setDocumentEdited(false)
  return getDocument()
}

export async function renameDocument(value: unknown): Promise<DocumentState> {
  if (typeof value !== 'string') throw new Error('invalid file name.')
  let name = value.trim()
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/<>:"|?*]|\p{Cc}/u.test(name) ||
    /[. ]$/.test(name)
  )
    throw new Error(
      'enter a file name without path separators or reserved characters.',
    )
  if (!extname(name)) name += '.md'
  if (
    !/\.(md|markdown|txt)$/i.test(name) ||
    Buffer.byteLength(name) > 255 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('choose a valid markdown file name.')
  if (!path) {
    untitledName = name
    return getDocument()
  }
  const destination = join(dirname(path), name)
  if (destination === path) return getDocument()
  const existing = await lstat(destination).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    },
  )
  if (existing) {
    if (!existing.isSymbolicLink() && (await realpath(destination)) === path) {
      await rename(path, destination)
      path = destination
      return getDocument()
    }
    throw new Error('a file with that name already exists.')
  }
  // Linking creates the new name atomically without replacing another file.
  try {
    await link(path, destination)
  } catch (error) {
    if (
      !['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw error
    await copyFile(path, destination, constants.COPYFILE_EXCL)
  }
  try {
    await unlink(path)
  } catch {
    throw new Error(`created ${name}, but could not remove the original file.`)
  }
  path = destination
  return getDocument()
}

export async function openDocument(
  window: BrowserWindow,
): Promise<DocumentState | null> {
  if (!(await confirmDiscard(window))) return null
  const current = markdown
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'markdown', extensions: ['md', 'markdown', 'txt'] }],
  })
  const selected = result.filePaths[0]
  if (result.canceled || !selected) return null
  const chosen = await realpath(selected)
  return loadDocument(window, chosen, current)
}

export async function loadDocument(
  window: BrowserWindow,
  chosen: string,
  current = markdown,
): Promise<DocumentState> {
  const content = await readMarkdown(chosen)
  if (markdown !== current)
    throw new Error('document changed while opening a file. please try again.')
  path = chosen
  markdown = saved = content
  revision += 1
  window.setDocumentEdited(false)
  return getDocument()
}
