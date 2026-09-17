import type { Addon } from '../../addons/api'
import type { SideloadFactory } from '../../addons/sdk'
import type { InstalledAddon } from '../../shared/sideload'

const bundledModules = import.meta.glob<Addon>(
  ['../../addons/*/index.{ts,tsx}', '../../useraddons/*/index.{ts,tsx}'],
  { eager: true, import: 'default' },
)
const bundled = Object.values(bundledModules)
const origins = new Map(
  Object.entries(bundledModules).map(([path, addon]) => [
    addon.manifest.id,
    path.includes('/useraddons/') ? 'local' : 'built-in',
  ]),
)
export let addons = bundled
const installed = new Map<
  string,
  { signature: string; addon: Addon; source: 'local' | 'third-party' }
>()
const listeners = new Set<() => void>()
const publish = () => {
  addons = [...bundled, ...[...installed.values()].map((entry) => entry.addon)]
  for (const listener of listeners) listener()
}
function installedAddon(item: InstalledAddon): Addon {
  let generation = 0
  let instance: Omit<Addon, 'manifest'> | null = null
  const addon: Addon = {
    manifest: item.manifest,
    async start(context) {
      const token = ++generation
      if (item.manifest.kind === 'theme') {
        for (const theme of item.themes) context.colorschemes.register(theme)
        return
      }
      if (!item.url) throw new Error('missing installed extension entry.')
      const [module, { sdk }] = await Promise.all([
        import(/* @vite-ignore */ item.url) as Promise<{
          default?: SideloadFactory
        }>,
        import('../../addons/sdk'),
      ])
      if (token !== generation) return
      if (typeof module.default !== 'function')
        throw new Error('extension entry must export a factory function.')
      const definition = module.default(sdk)
      if (
        !definition ||
        typeof definition.start !== 'function' ||
        (definition.stop !== undefined &&
          typeof definition.stop !== 'function') ||
        (definition.Settings !== undefined &&
          typeof definition.Settings !== 'function')
      )
        throw new Error('invalid installed extension definition.')
      instance = definition
      if (definition.Settings) addon.Settings = definition.Settings
      if (definition.flavors) addon.flavors = definition.flavors
      publish()
      await definition.start(context)
    },
    stop() {
      generation++
      const previous = instance
      instance = null
      previous?.stop?.()
    },
  }
  return addon
}
export const addonRegistry = {
  snapshot: () => addons,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  isInstalled: (id: string) => installed.has(id),
  origin: (id: string) =>
    installed.get(id)?.source ?? origins.get(id) ?? 'local',
  hydrate(packages: readonly InstalledAddon[]) {
    const ids = new Set(packages.map((item) => item.manifest.id))
    for (const id of installed.keys()) if (!ids.has(id)) installed.delete(id)
    for (const item of packages) {
      const signature = JSON.stringify(item)
      if (installed.get(item.manifest.id)?.signature !== signature)
        installed.set(item.manifest.id, {
          signature,
          addon: installedAddon(item),
          source: item.source ?? 'local',
        })
    }
    publish()
  },
}
