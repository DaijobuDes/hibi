import catalog from 'virtual:hibi-addon-catalog/main'
import { validateAddonRequirements } from '../shared/addon-dependencies'
import { parseAddonManifest } from '../shared/addon-manifest'
import { MAX_ADDON_MANIFEST_BYTES } from '../shared/addon-package'
import { getAddonManifests, getAddonStates, refreshAddonStates } from './addons'
import { setDocumentExtensions } from './document-types'

/** Development metadata only; native loaders keep the guarded process restart. */
export async function updateDevelopmentAddon(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_ADDON_MANIFEST_BYTES)
    throw new Error('The addon manifest exceeds 64 KiB.')
  const { manifest } = parseAddonManifest(value, { trust: 'compiled' })
  const previous = catalog.find(
    (item) => item.manifest.id === manifest.id,
  )?.manifest
  if (!previous) throw new Error('Restart development after adding an addon.')
  validateAddonRequirements(
    getAddonManifests().map((item) =>
      item.id === manifest.id ? manifest : item,
    ),
  )
  const before = getAddonStates()
  const { default: details } = await import(
    'virtual:hibi-addon-catalog/details'
  )
  for (const key of Object.keys(previous))
    delete (previous as unknown as Record<string, unknown>)[key]
  Object.assign(previous, manifest)
  details[manifest.id] = manifest.licenses
    ? { licenses: manifest.licenses }
    : {}
  setDocumentExtensions(
    getAddonManifests().flatMap((item) => item.fileExtensions ?? []),
  )
  return refreshAddonStates(before)
}
