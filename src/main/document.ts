import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { type BrowserWindow, dialog } from 'electron'
import type { DocumentState } from '../shared/desktop'
import { readMarkdown, validateMarkdown, writeMarkdown } from './files'

let markdown = ''
let saved = ''
let path: string | null = null
let revision = 0

export function getDocument(): DocumentState {
  return {
    markdown,
    savedMarkdown: saved,
    name: path ? basename(path) : 'untitled.md',
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
): Promise<DocumentState | null> {
  let destination = path
  const content = markdown
  if (!destination || saveAs) {
    const result = await dialog.showSaveDialog(window, {
      defaultPath: destination ?? 'untitled.md',
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
    message: `save changes to ${path ? basename(path) : 'untitled.md'}?`,
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
  revision += 1
  window.setDocumentEdited(false)
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
  const content = await readMarkdown(chosen)
  if (markdown !== current)
    throw new Error('document changed while opening a file. please try again.')
  path = chosen
  markdown = saved = content
  revision += 1
  window.setDocumentEdited(false)
  return getDocument()
}
