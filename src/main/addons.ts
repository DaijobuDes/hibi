import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, type BrowserWindow, dialog } from 'electron'
import {
  ADDON_API_VERSION,
  type AddonManifest,
  type AddonState,
  type NativeAddon,
} from '../addons/api'
import { validDocumentExtensions } from '../shared/document-types'
import { exportedAppearance } from './appearance'
import {
  clearDocument,
  getDocument,
  getDocumentPath,
  hasUnsavedDocuments,
  loadDocument,
  newDocument,
  renameDocument,
  updateDocument,
} from './document'
import { setDocumentExtensions } from './document-types'
import { validateMarkdown, writeText } from './files'
import {
  installedAddons,
  installPackage,
  loadInstalledAddons,
  removePackage,
} from './sideload'
import {
  getWorkspace,
  refreshWorkspace,
  resolveWorkspaceFile,
  snapshotWorkspace,
  workspaceId,
  workspaceRoot,
} from './workspace'

const manifestModules = import.meta.glob<AddonManifest>(
  ['../addons/*/manifest.ts', '../useraddons/*/manifest.ts'],
  { eager: true, import: 'default' },
)
const bundledManifests = Object.values(manifestModules)
const nativeModules = import.meta.glob<NativeAddon>(
  ['../addons/*/native.ts', '../useraddons/*/native.ts'],
  { import: 'default' },
)
const nativeLoaders = new Map(
  Object.entries(manifestModules).flatMap(([path, manifest]) => {
    const load = nativeModules[path.replace('/manifest.ts', '/native.ts')]
    return load ? [[manifest.id, load] as const] : []
  }),
)
const natives = new Map<string, NativeAddon>()
const pendingNatives = new Map<string, Promise<NativeAddon>>()
const generations = new Map<string, number>()
async function nativeAddon(id: string) {
  if (natives.has(id)) return natives.get(id)
  const load = nativeLoaders.get(id)
  if (!load) return undefined
  let pending = pendingNatives.get(id)
  if (!pending) {
    pending = load()
      .then((addon) => {
        if (addon.id !== id) throw new Error('Native addon identity mismatch.')
        natives.set(id, addon)
        return addon
      })
      .finally(() => pendingNatives.delete(id))
    pendingNatives.set(id, pending)
  }
  return pending
}
let enabled: Record<string, boolean> = {}
const manifests = () => [
  ...bundledManifests,
  ...installedAddons().map((addon) => addon.manifest),
]

export function getAddonLicenses() {
  return manifests().flatMap((manifest) =>
    (manifest.licenses ?? []).map((license) => ({
      ...license,
      id: `addon:${manifest.id}:${license.id}`,
    })),
  )
}

export async function loadAddons(): Promise<void> {
  const [, stored] = await Promise.all([
    loadInstalledAddons(bundledManifests.map((manifest) => manifest.id)),
    readFile(join(app.getPath('userData'), 'addons.json'), 'utf8')
      .then((text): Record<string, unknown> => {
        const value: unknown = JSON.parse(text)
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('invalid addon preferences')
        return value as Record<string, unknown>
      })
      .catch((error: unknown): Record<string, unknown> => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.error('could not load addon preferences:', error)
        return {}
      }),
  ])
  const ids = new Set<string>()
  for (const manifest of manifests()) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(manifest.id) ||
      ids.has(manifest.id) ||
      (manifest.fileExtensions !== undefined &&
        !validDocumentExtensions(manifest.fileExtensions)) ||
      manifest.apiVersion !== ADDON_API_VERSION
    )
      throw new Error('invalid or incompatible addon manifest.')
    ids.add(manifest.id)
  }
  setDocumentExtensions(
    manifests().flatMap((manifest) => manifest.fileExtensions ?? []),
  )
  enabled = Object.fromEntries(
    manifests()
      .filter(({ id }) => typeof stored[id] === 'boolean')
      .map(({ id }) => [id, stored[id] as boolean]),
  )
}

export function getAddonStates(): AddonState[] {
  setDocumentExtensions(
    manifests().flatMap((manifest) => manifest.fileExtensions ?? []),
  )
  return manifests().map(({ id, defaultEnabled }) => ({
    id,
    enabled: id === 'markdown' || (enabled[id] ?? defaultEnabled ?? false),
  }))
}

export async function enableAddon(
  id: unknown,
  value: unknown,
): Promise<AddonState[]> {
  if (
    typeof id !== 'string' ||
    !manifests().some((manifest) => manifest.id === id) ||
    typeof value !== 'boolean'
  )
    throw new Error('invalid addon preference.')
  return saveEnabled(id, id === 'markdown' || value)
}

async function saveEnabled(id: string, value: boolean): Promise<AddonState[]> {
  const next = { ...enabled, [id]: value }
  const path = join(app.getPath('userData'), 'addons.json')
  await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
  enabled = next
  generations.set(id, (generations.get(id) ?? 0) + 1)
  if (!value) natives.get(id)?.stop?.()
  return getAddonStates()
}

export async function installAddon(
  window: BrowserWindow,
  url?: unknown,
): Promise<void> {
  await installPackage(
    window,
    bundledManifests.map((manifest) => manifest.id),
    async (id) => {
      const previous = enabled[id] ?? false
      await saveEnabled(id, false)
      return async () => {
        await saveEnabled(id, previous)
      }
    },
    url,
  )
}

export async function removeAddon(id: unknown): Promise<void> {
  if (
    typeof id !== 'string' ||
    !installedAddons().some((addon) => addon.manifest.id === id)
  )
    throw new Error('only sideloaded addons can be removed.')
  const previous = enabled[id] ?? false
  await saveEnabled(id, false)
  try {
    await removePackage(id)
  } catch (error) {
    await saveEnabled(id, previous)
    throw error
  }
}

export async function invokeAddon(
  window: BrowserWindow,
  id: unknown,
  method: unknown,
  input: unknown,
  query = false,
): Promise<unknown> {
  if (
    typeof id !== 'string' ||
    typeof method !== 'string' ||
    !getAddonStates().some((addon) => addon.id === id && addon.enabled)
  )
    throw new Error('addon is not enabled.')
  const generation = generations.get(id)
  const addon = await nativeAddon(id)
  if (
    generations.get(id) !== generation ||
    !getAddonStates().some((state) => state.id === id && state.enabled)
  )
    throw new Error('addon is no longer enabled.')
  const handlers = query ? addon?.queries : addon?.methods
  if (!handlers || !Object.hasOwn(handlers, method))
    throw new Error('unknown addon method.')
  const handler = handlers[method]
  if (!handler) throw new Error('unknown addon method.')
  return handler(input, {
    document: {
      get: getDocument,
      async path(id) {
        if (!id || id === getDocument().id) return getDocumentPath()
        const base = workspaceRoot()
        if (!base)
          throw new Error('the document is no longer in this workspace.')
        async function find(
          entries: import('../shared/workspace').WorkspaceEntry[],
        ): Promise<string | null> {
          for (const entry of entries) {
            if (entry.children) {
              const match = await find(entry.children)
              if (match) return match
            } else {
              const path = await resolveWorkspaceFile(base!, entry.path)
              if (createHash('sha256').update(path).digest('hex') === id)
                return path
            }
          }
          return null
        }
        const path = await find(getWorkspace()?.entries ?? [])
        if (!path)
          throw new Error('the document is no longer in this workspace.')
        return path
      },
      async create(name, source) {
        validateMarkdown(source)
        if (!(await newDocument(window))) return false
        await renameDocument(name)
        updateDocument(source)
        window.setDocumentEdited(getDocument().dirty)
        return true
      },
    },
    async exportFile(bytes, suggestedName, extension) {
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength > 64 * 1024 * 1024 ||
        !/^[a-z0-9]{1,12}$/.test(extension)
      )
        throw new Error('invalid export file.')
      const result = await dialog.showSaveDialog(window, {
        title: 'Export document',
        defaultPath: basename(suggestedName),
        filters: [{ name: extension, extensions: [extension] }],
      })
      if (result.canceled || !result.filePath) return null
      if (
        (await realpath(result.filePath).catch(() => result.filePath)) ===
        getDocumentPath()
      )
        throw new Error('choose a different filename from the open document.')
      await writeText(result.filePath, bytes)
      return result.filePath
    },
    workspace: {
      id: workspaceId,
      directory: workspaceRoot,
      hasUnsavedChanges: hasUnsavedDocuments,
      async reload() {
        if (hasUnsavedDocuments())
          throw new Error('save or discard edits before reloading files.')
        const path = getDocumentPath()
        if (path) {
          const exists = await lstat(path).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error
              return null
            },
          )
          if (exists?.isFile()) await loadDocument(window, path)
          else clearDocument(window)
        }
        await refreshWorkspace()
      },
      snapshot: async () => ({
        ...(await snapshotWorkspace()),
        appearance: exportedAppearance(),
      }),
    },
    async exportHtml(html, suggestedName, pages) {
      const result = await dialog.showSaveDialog(window, {
        title: 'Export documentation',
        defaultPath: basename(suggestedName),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (result.canceled || !result.filePath) return null
      const path = result.filePath
      await writeText(path, html)
      return { path, pages }
    },
  })
}
