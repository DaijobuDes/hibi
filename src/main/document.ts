import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  realpath,
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
import { type BrowserWindow, dialog } from 'electron'
import type { AutosaveResult, DocumentState } from '../shared/desktop'
import {
  isMarkdownDocument,
  markdownExtensions,
} from '../shared/document-types'
import { HISTORY_CHANNELS } from '../shared/history'
import { documentExtensions, isDocumentName } from './document-types'
import { readMarkdown, validateMarkdown, writeMarkdown } from './files'
import { recordVersion } from './history'

let markdown = ''
let saved = ''
let path: string | null = null
let pendingPath: string | null = null
let revision = 0
let untitledName = 'untitled.md'
let draftId = randomUUID()
let back: (string | null)[] = []
let forward: (string | null)[] = []

function rememberLocation() {
  back.push(path)
  if (back.length > 100) back.shift()
  forward = []
}

export async function navigateDocument(
  window: BrowserWindow,
  direction: unknown,
): Promise<DocumentState | null> {
  if (direction !== 'back' && direction !== 'forward')
    throw new Error('invalid navigation direction.')
  const from = direction === 'back' ? back : forward
  const to = direction === 'back' ? forward : back
  if (!from.length || !(await confirmDiscard(window))) return null
  const destination = from.at(-1)!
  const previous = path
  const result =
    destination === null
      ? clearDocument(window, false)
      : await loadDocument(window, destination, markdown, false)
  from.pop()
  to.push(previous)
  return result
}

export function importDocument(
  window: BrowserWindow,
  content: string,
  name: string,
) {
  validateMarkdown(content)
  clearDocument(window)
  untitledName = name
  markdown = content
  window.setDocumentEdited(markdown !== saved)
  return getDocument()
}

export function getDocumentPath(): string | null {
  return path ?? pendingPath
}

export function getDocument(): DocumentState {
  const currentPath = getDocumentPath()
  return {
    id: currentPath
      ? createHash('sha256').update(currentPath).digest('hex')
      : draftId,
    markdown,
    savedMarkdown: saved,
    name: currentPath ? basename(currentPath) : untitledName,
    dirty: markdown !== saved || !!pendingPath,
    ephemeral: !!pendingPath,
    revision,
    canAutosave: path !== null,
  }
}

export function discardChanges(): void {
  markdown = saved
  pendingPath = null
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
  automatic = false,
): Promise<DocumentState | null> {
  let destination = path ?? pendingPath
  const exclusive = !!pendingPath && !saveAs
  const content = markdown
  if (!destination || saveAs) {
    if (automatic) return null
    const result = await dialog.showSaveDialog(window, {
      defaultPath: destination ?? defaultPath ?? untitledName,
      filters: [
        {
          name: 'documents',
          extensions: isMarkdownDocument(destination ?? untitledName)
            ? markdownExtensions
            : [extname(destination ?? untitledName).slice(1) || 'md'],
        },
      ],
    })
    if (result.canceled || !result.filePath) return null
    destination = result.filePath
  }
  const chosen = destination
  destination = await realpath(chosen).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return join(await realpath(dirname(chosen)), basename(chosen))
    },
  )
  let previous: string | null = null
  if (destination === path) {
    const disk = await readMarkdown(destination).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return null
      },
    )
    previous = disk
    if (disk !== saved) {
      if (automatic) return null
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
  await writeMarkdown(destination, content, exclusive)
  path = destination
  pendingPath = null
  saved = content
  window.setDocumentEdited(markdown !== saved)
  try {
    if (previous !== null) await recordVersion(destination, previous)
    await recordVersion(destination, content)
  } catch (error) {
    console.error('local history failed:', error)
    window.webContents.send(
      HISTORY_CHANNELS.notice,
      'file saved, but its local history could not be updated.',
    )
  }
  return getDocument()
}

export async function autosaveDocument(
  window: BrowserWindow,
  expectedRevision: unknown,
): Promise<AutosaveResult> {
  if (expectedRevision !== revision || !path || !getDocument().dirty)
    return { status: 'skipped', document: null }
  const document = await saveDocument(window, false, undefined, true)
  return { status: document ? 'saved' : 'conflict', document }
}

export function restoreDocument(
  window: BrowserWindow,
  content: string,
): DocumentState {
  validateMarkdown(content)
  markdown = content
  revision += 1
  window.setDocumentEdited(markdown !== saved)
  return getDocument()
}

export async function confirmDiscard(window: BrowserWindow): Promise<boolean> {
  if (markdown === saved && !pendingPath) return true
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
  return clearDocument(window)
}

export function clearDocument(
  window: BrowserWindow,
  remember = true,
): DocumentState {
  if (remember) rememberLocation()
  markdown = saved = ''
  draftId = randomUUID()
  path = null
  pendingPath = null
  untitledName = 'untitled.md'
  revision += 1
  window.setDocumentEdited(false)
  return getDocument()
}

export async function newPendingDocument(
  window: BrowserWindow,
  destination: string,
): Promise<DocumentState | null> {
  if (!(await newDocument(window))) return null
  pendingPath = destination
  window.setDocumentEdited(true)
  return getDocument()
}

export function relocateDocument(from: string, to: string): void {
  const relocate = (current: string | null) => {
    if (!current) return null
    const child = relative(from, current)
    return child === ''
      ? to
      : !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`)
        ? join(to, child)
        : current
  }
  path = relocate(path)
  pendingPath = relocate(pendingPath)
  back = back.map(relocate)
  forward = forward.map(relocate)
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
  if (!extname(name))
    name += extname(path ?? pendingPath ?? untitledName) || '.md'
  if (
    !isDocumentName(name) ||
    Buffer.byteLength(name) > 255 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('choose a valid markdown file name.')
  if (!path) {
    if (pendingPath) {
      const destination = join(dirname(pendingPath), name)
      const exists = await lstat(destination).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return null
        },
      )
      if (exists) throw new Error('a file with that name already exists.')
      pendingPath = destination
    }
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
      relocateDocument(path, destination)
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
  relocateDocument(path, destination)
  return getDocument()
}

export async function openDocument(
  window: BrowserWindow,
): Promise<DocumentState | null> {
  if (!(await confirmDiscard(window))) return null
  const current = markdown
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'documents', extensions: documentExtensions() }],
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
  remember = true,
): Promise<DocumentState> {
  chosen = await realpath(chosen)
  const content = await readMarkdown(chosen)
  if (markdown !== current)
    throw new Error('document changed while opening a file. please try again.')
  if (remember && chosen !== path) rememberLocation()
  path = chosen
  pendingPath = null
  markdown = saved = content
  revision += 1
  window.setDocumentEdited(false)
  return getDocument()
}
