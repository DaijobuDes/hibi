import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, type BrowserWindow, dialog } from 'electron'
import {
  ADDON_API_VERSION,
  type AddonManifest,
  type AddonState,
  type NativeAddon,
} from '../addons/api'
import { exportedAppearance } from './appearance'
import { writeText } from './files'
import { snapshotWorkspace } from './workspace'

const manifests = Object.values(
  import.meta.glob<AddonManifest>(
    ['../addons/*/manifest.ts', '../useraddons/*/manifest.ts'],
    { eager: true, import: 'default' },
  ),
)
const natives = Object.values(
  import.meta.glob<NativeAddon>(
    ['../addons/*/native.ts', '../useraddons/*/native.ts'],
    { eager: true, import: 'default' },
  ),
)
let enabled: Record<string, boolean> = {}

export async function loadAddons(): Promise<void> {
  const ids = new Set<string>()
  for (const manifest of manifests) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(manifest.id) ||
      ids.has(manifest.id) ||
      manifest.apiVersion !== ADDON_API_VERSION
    )
      throw new Error('invalid or incompatible addon manifest.')
    ids.add(manifest.id)
  }
  try {
    const stored = JSON.parse(
      await readFile(join(app.getPath('userData'), 'addons.json'), 'utf8'),
    ) as Record<string, unknown>
    enabled = Object.fromEntries(
      manifests
        .filter(({ id }) => typeof stored[id] === 'boolean')
        .map(({ id }) => [id, stored[id] as boolean]),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('could not load addon preferences:', error)
  }
}

export function getAddonStates(): AddonState[] {
  return manifests.map(({ id, defaultEnabled }) => ({
    id,
    enabled: enabled[id] ?? defaultEnabled ?? false,
  }))
}

export async function enableAddon(
  id: unknown,
  value: unknown,
): Promise<AddonState[]> {
  if (
    typeof id !== 'string' ||
    !manifests.some((manifest) => manifest.id === id) ||
    typeof value !== 'boolean'
  )
    throw new Error('invalid addon preference.')
  const next = { ...enabled, [id]: value }
  const path = join(app.getPath('userData'), 'addons.json')
  await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
  enabled = next
  return getAddonStates()
}

export async function invokeAddon(
  window: BrowserWindow,
  id: unknown,
  method: unknown,
  input: unknown,
): Promise<unknown> {
  if (
    typeof id !== 'string' ||
    typeof method !== 'string' ||
    !getAddonStates().some((addon) => addon.id === id && addon.enabled)
  )
    throw new Error('addon is not enabled.')
  const addon = natives.find((addon) => addon.id === id)
  if (!addon || !Object.hasOwn(addon.methods, method))
    throw new Error('unknown addon method.')
  const handler = addon.methods[method]
  if (!handler) throw new Error('unknown addon method.')
  return handler(input, {
    workspace: {
      snapshot: async () => ({
        ...(await snapshotWorkspace()),
        appearance: exportedAppearance(),
      }),
    },
    async exportHtml(html, suggestedName, pages) {
      const result = await dialog.showSaveDialog(window, {
        title: 'export documentation',
        defaultPath: basename(suggestedName),
        filters: [{ name: 'html', extensions: ['html'] }],
      })
      if (result.canceled || !result.filePath) return null
      const path = result.filePath
      await writeText(path, html)
      return { path, pages }
    },
  })
}
