import { type FSWatcher, watch } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { type BrowserWindow, dialog } from 'electron'
import type {
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceState,
} from '../shared/workspace'
import {
  confirmDiscard,
  getDocument,
  getDocumentPath,
  loadDocument,
} from './document'
import { readMarkdown } from './files'

let root: string | null = null
let entries: WorkspaceEntry[] = []
let watcher: FSWatcher | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let onChanged: () => void = () => {}

export function workspaceRoot(): string | null {
  return root
}

function relativePath(base: string, path: string): string | null {
  const value = relative(base, path)
  return value &&
    !value.startsWith(`..${sep}`) &&
    value !== '..' &&
    !isAbsolute(value)
    ? value.split(sep).join('/')
    : null
}

export async function scanWorkspace(base: string): Promise<WorkspaceEntry[]> {
  let count = 0
  async function walk(directory: string): Promise<WorkspaceEntry[]> {
    const result: WorkspaceEntry[] = []
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      if (
        child.name.startsWith('.') ||
        child.name === 'node_modules' ||
        child.isSymbolicLink()
      )
        continue
      if (++count > 20000)
        throw new Error(
          'this folder is too large. open a smaller documentation folder.',
        )
      const full = join(directory, child.name)
      const path = relative(base, full).split(sep).join('/')
      if (child.isDirectory()) {
        const nested = await walk(full)
        result.push({
          path,
          name: child.name,
          kind: 'folder',
          children: nested,
        })
      } else if (child.isFile() && /\.(md|markdown)$/i.test(child.name)) {
        result.push({ path, name: child.name, kind: 'file' })
      }
    }
    return result.sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
  }
  return walk(base)
}

export function getWorkspace(): WorkspaceState | null {
  if (!root) return null
  const path = getDocumentPath()
  return {
    name: basename(root),
    entries,
    activePath: path ? relativePath(root, path) : null,
  }
}

export async function refreshWorkspace(): Promise<WorkspaceState | null> {
  const selected = root
  if (selected) {
    const next = await scanWorkspace(selected)
    if (root === selected) entries = next
  }
  return getWorkspace()
}

export function observeWorkspace(callback: () => void): void {
  onChanged = callback
}

export async function openWorkspace(
  window: BrowserWindow,
): Promise<WorkspaceState | null> {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'open workspace',
  })
  const selected = result.filePaths[0]
  if (result.canceled || !selected) return null
  const nextRoot = await realpath(selected)
  const nextEntries = await scanWorkspace(nextRoot)
  watcher?.close()
  clearTimeout(refreshTimer)
  root = nextRoot
  entries = nextEntries
  try {
    watcher = watch(root, { recursive: true, persistent: false }, () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void refreshWorkspace()
          .then(onChanged)
          .catch((error: unknown) =>
            console.error('workspace refresh failed:', error),
          )
      }, 200)
    })
    watcher.on('error', (error) =>
      console.error('workspace watcher failed:', error),
    )
  } catch (error) {
    console.error('workspace watcher unavailable:', error)
  }
  return getWorkspace()
}

export async function resolveWorkspaceFile(
  base: string,
  value: unknown,
): Promise<string> {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/\.(md|markdown)$/i.test(value)
  )
    throw new Error('invalid workspace file.')
  const candidate = join(base, value)
  if ((await lstat(candidate)).isSymbolicLink())
    throw new Error('workspace symlinks are not supported.')
  const chosen = await realpath(candidate)
  if (!relativePath(base, chosen))
    throw new Error('file is outside the workspace.')
  return chosen
}

export async function openWorkspaceFile(window: BrowserWindow, path: unknown) {
  if (!root) throw new Error('open a workspace first.')
  if (!(await confirmDiscard(window))) return null
  return loadDocument(window, await resolveWorkspaceFile(root, path))
}

export async function snapshotWorkspace(): Promise<WorkspaceSnapshot> {
  const selected = root
  if (!selected) throw new Error('open a workspace first.')
  const tree = await scanWorkspace(selected)
  const pages: WorkspaceSnapshot['pages'] = []
  const currentPath = getDocumentPath()
  const currentMarkdown = getDocument().markdown
  let bytes = 0
  async function collect(items: WorkspaceEntry[]) {
    for (const item of items) {
      if (item.kind === 'folder') await collect(item.children ?? [])
      else {
        const path = await resolveWorkspaceFile(selected as string, item.path)
        const markdown =
          path === currentPath ? currentMarkdown : await readMarkdown(path)
        bytes += Buffer.byteLength(markdown)
        if (pages.length >= 2000 || bytes > 20 * 1024 * 1024)
          throw new Error(
            'export supports up to 2,000 documents and 20 mib of markdown.',
          )
        pages.push({ path: item.path, markdown })
      }
    }
  }
  await collect(tree)
  if (!pages.length)
    throw new Error('this workspace has no markdown documents.')
  return { name: basename(selected), pages }
}
