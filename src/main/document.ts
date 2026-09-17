import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  readFile,
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
import { app, type BrowserWindow, dialog } from 'electron'
import type {
  AutosaveResult,
  DocumentState,
  DocumentTab,
} from '../shared/desktop'
import {
  isMarkdownDocument,
  markdownExtensions,
} from '../shared/document-types'
import { HISTORY_CHANNELS } from '../shared/history'
import { documentExtensions, isDocumentName } from './document-types'
import {
  readMarkdown,
  validateMarkdown,
  writeMarkdown,
  writeText,
} from './files'
import { recordVersion } from './history'

let markdown = ''
let saved = ''
let path: string | null = null
let pendingPath: string | null = null
let revision = 0
let untitledName = 'untitled.md'
let draftId = randomUUID()
let back: string[] = []
let forward: string[] = []
let activeTab: string = randomUUID()
const tabs = new Map<string, ReturnType<typeof snapshot>>()
let tabsEnabled = true
const tabsPreferencePath = () =>
  join(app.getPath('userData'), 'document-tabs.json')

export async function loadDocumentPreferences() {
  try {
    tabsEnabled =
      JSON.parse(await readFile(tabsPreferencePath(), 'utf8')) !== false
  } catch {
    tabsEnabled = true
  }
}

export async function setTabsEnabled(window: BrowserWindow, enabled: unknown) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid tabs preference.')
  const closing = enabled
    ? []
    : getOpenDocuments().filter((draft) => draft.tabId !== activeTab)
  for (const draft of closing)
    if (!(await confirmTabDiscard(window, draft.tabId))) return getDocument()
  await writeText(tabsPreferencePath(), JSON.stringify(enabled))
  tabsEnabled = enabled
  if (!enabled) {
    back = []
    forward = []
  }
  return removeTabs(window, new Set(closing.map((draft) => draft.tabId)))
}

function snapshot() {
  return { markdown, saved, path, pendingPath, untitledName, draftId }
}
function storeTab() {
  tabs.set(activeTab, snapshot())
}
function activateTab(id: string) {
  const draft = tabs.get(id)
  if (!draft) throw new Error('this tab is no longer open.')
  activeTab = id
  ;({ markdown, saved, path, pendingPath, untitledName, draftId } = draft)
}
async function startTab(window: BrowserWindow, reuseEmpty = false) {
  if (!tabsEnabled) {
    if (!(await confirmDiscard(window))) return false
    tabs.clear()
    back = []
    forward = []
    activeTab = randomUUID()
    return true
  }
  storeTab()
  if (reuseEmpty && isEmptyTab()) return true
  activeTab = randomUUID()
  return true
}
function isEmptyTab() {
  return !path && !pendingPath && !markdown && untitledName === 'untitled.md'
}
export function getOpenDocuments() {
  storeTab()
  return [...tabs].map(([id, draft]) => ({
    ...draft,
    tabId: id,
    file: draft.path ?? draft.pendingPath,
    dirty: draft.markdown !== draft.saved || !!draft.pendingPath,
  }))
}
export function getDocumentTabs(): DocumentTab[] {
  return getOpenDocuments().map((draft) => ({
    id: draft.tabId,
    name: draft.file ? basename(draft.file) : draft.untitledName,
    dirty: draft.dirty,
  }))
}
export function hasUnsavedDocuments() {
  return getOpenDocuments().some((draft) => draft.dirty)
}
export async function selectDocumentTab(
  window: BrowserWindow,
  id: unknown,
  remember = true,
  refresh = false,
): Promise<DocumentState> {
  storeTab()
  if (typeof id !== 'string' || !tabs.has(id))
    throw new Error('this tab is no longer open.')
  if (id === activeTab && !refresh) return getDocument()
  const draft = tabs.get(id)!
  const current = markdown
  // Refresh clean files on return; dirty tabs keep their saved baseline for conflict checks.
  if (draft.path && draft.markdown === draft.saved) {
    const content = await readMarkdown(draft.path)
    if (markdown !== current)
      throw new Error(
        'document changed while switching tabs. please try again.',
      )
    draft.markdown = draft.saved = content
  }
  if (remember && id !== activeTab) rememberLocation()
  activateTab(id)
  revision++
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}

async function confirmTabDiscard(window: BrowserWindow, id: string) {
  storeTab()
  const previous = activeTab
  try {
    activateTab(id)
    return await confirmDiscard(window)
  } finally {
    storeTab()
    activateTab(previous)
    window.setDocumentEdited(hasUnsavedDocuments())
  }
}
export async function confirmDiscardAll(
  window: BrowserWindow,
  within?: string,
) {
  const affected = getOpenDocuments().filter(
    (draft) => !within || containsPath(within, draft.file),
  )
  for (const draft of affected)
    if (draft.dirty && !(await confirmTabDiscard(window, draft.tabId)))
      return false
  return true
}
function containsPath(parent: string, file: string | null) {
  if (!file) return false
  const child = relative(parent, file)
  return (
    child === '' ||
    (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
  )
}
function removeTabs(window: BrowserWindow, ids: Set<string>) {
  storeTab()
  const order = [...tabs.keys()]
  const currentIndex = order.indexOf(activeTab)
  for (const id of ids) tabs.delete(id)
  back = back.filter((id) => !ids.has(id))
  forward = forward.filter((id) => !ids.has(id))
  if (ids.has(activeTab)) {
    const next =
      order.slice(currentIndex + 1).find((id) => tabs.has(id)) ??
      [...tabs.keys()].at(-1)
    if (next) {
      activateTab(next)
      revision++
    } else {
      activeTab = randomUUID()
      clearDocument(window, false)
    }
  }
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}
export async function closeDocumentTab(window: BrowserWindow, id: unknown) {
  storeTab()
  if (typeof id !== 'string' || !tabs.has(id))
    throw new Error('this tab is no longer open.')
  if (!(await confirmTabDiscard(window, id))) return null
  return removeTabs(window, new Set([id]))
}

export function moveDocumentTab(id: unknown, beforeId: unknown) {
  storeTab()
  if (
    typeof id !== 'string' ||
    !tabs.has(id) ||
    (beforeId !== null && (typeof beforeId !== 'string' || !tabs.has(beforeId)))
  )
    throw new Error('This tab is no longer open.')
  if (id === beforeId) return getDocument()
  const draft = tabs.get(id)!
  const entries = [...tabs].filter(([key]) => key !== id)
  const index =
    beforeId === null
      ? entries.length
      : entries.findIndex(([key]) => key === beforeId)
  entries.splice(index, 0, [id, draft])
  tabs.clear()
  for (const [key, value] of entries) tabs.set(key, value)
  return getDocument()
}
export function closeDeletedDocuments(window: BrowserWindow, parent: string) {
  return removeTabs(
    window,
    new Set(
      getOpenDocuments()
        .filter((draft) => containsPath(parent, draft.file))
        .map((draft) => draft.tabId),
    ),
  )
}

function rememberLocation() {
  if (!tabsEnabled) return
  back.push(activeTab)
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
  if (!from.length) return null
  const destination = from.at(-1)!
  const previous = activeTab
  const result = await selectDocumentTab(window, destination, false)
  from.pop()
  to.push(previous)
  return result
}

export async function importDocument(
  window: BrowserWindow,
  content: string,
  name: string,
) {
  validateMarkdown(content)
  if (!isEmptyTab()) rememberLocation()
  if (!(await startTab(window, true))) return null
  clearDocument(window, false)
  untitledName = name
  markdown = content
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}

export function getDocumentPath(): string | null {
  return path ?? pendingPath
}

export function getDocument(): DocumentState {
  const currentPath = getDocumentPath()
  return {
    tabId: activeTab,
    tabs: getDocumentTabs(),
    tabsEnabled,
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
  storeTab()
  for (const draft of tabs.values()) {
    draft.markdown = draft.saved
    draft.pendingPath = null
  }
  activateTab(activeTab)
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
          name: 'Documents',
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
  if (
    getOpenDocuments().some(
      (draft) => draft.tabId !== activeTab && draft.file === destination,
    )
  )
    throw new Error(
      'this file is already open in another tab. choose a different name.',
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
        message: 'This file changed outside Hibi.',
        detail: 'Replace the file with your current document?',
        buttons: ['Replace', 'Cancel'],
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
  window.setDocumentEdited(hasUnsavedDocuments())
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
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}

export async function confirmDiscard(window: BrowserWindow): Promise<boolean> {
  if (markdown === saved && !pendingPath) return true
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    message: `Save changes to ${getDocument().name}?`,
    detail: 'Your changes will be lost if you do not save them.',
    buttons: ['Save', 'Don’t save', 'Cancel'],
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
  rememberLocation()
  if (!(await startTab(window))) return null
  return clearDocument(window, false)
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
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}

export async function newPendingDocument(
  window: BrowserWindow,
  destination: string,
): Promise<DocumentState | null> {
  if (!(await newDocument(window))) return null
  pendingPath = destination
  window.setDocumentEdited(hasUnsavedDocuments())
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
  storeTab()
  for (const draft of tabs.values()) {
    draft.path = relocate(draft.path)
    draft.pendingPath = relocate(draft.pendingPath)
  }
  activateTab(activeTab)
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
      if (
        getOpenDocuments().some(
          (draft) => draft.tabId !== activeTab && draft.file === destination,
        )
      )
        throw new Error('a file with that name is already open.')
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
  if (
    getOpenDocuments().some(
      (draft) => draft.tabId !== activeTab && draft.file === destination,
    )
  )
    throw new Error('a file with that name is already open.')
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
  const current = markdown
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: documentExtensions() }],
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
): Promise<DocumentState | null> {
  chosen = await realpath(chosen)
  const existing = getOpenDocuments().find((draft) => draft.file === chosen)
  if (existing) return selectDocumentTab(window, existing.tabId, remember, true)
  const content = await readMarkdown(chosen)
  if (markdown !== current)
    throw new Error('document changed while opening a file. please try again.')
  if (remember && chosen !== path && !isEmptyTab()) rememberLocation()
  if (!(await startTab(window, true))) return null
  path = chosen
  pendingPath = null
  markdown = saved = content
  revision += 1
  window.setDocumentEdited(hasUnsavedDocuments())
  return getDocument()
}
