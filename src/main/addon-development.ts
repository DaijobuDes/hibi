import catalog from 'virtual:hibi-addon-catalog/main'
import { validateAddonRequirements } from '../shared/addon-dependencies'
import { addonDevelopmentManifestContract } from '../shared/addon-development'
import { parseAddonManifest } from '../shared/addon-manifest'
import { MAX_ADDON_MANIFEST_BYTES } from '../shared/addon-package'
import { getAddonManifests, getAddonStates } from './addons'

/** Development metadata only; native loaders keep the guarded process restart. */
export async function updateDevelopmentAddon(
  value: unknown,
  contract: unknown,
) {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_ADDON_MANIFEST_BYTES)
    throw new Error('The addon manifest exceeds 64 KiB.')
  const { manifest } = parseAddonManifest(value, { trust: 'compiled' })
  const entry = catalog.find((item) => item.manifest.id === manifest.id)
  if (!entry) throw new Error('Restart development after adding an addon.')
  const previous = entry.manifest
  if (
    addonDevelopmentManifestContract(previous, Boolean(entry.loadNative)) !==
      addonDevelopmentManifestContract(manifest, Boolean(entry.loadNative)) ||
    typeof contract !== 'string' ||
    entry.developmentContract !== contract
  )
    throw new Error(
      'Addon contract changes are waiting for restart. Save drafts, then edit the addon again or restart development.',
    )
  validateAddonRequirements(
    getAddonManifests().map((item) =>
      item.id === manifest.id ? manifest : item,
    ),
  )
  const { default: details } = await import(
    'virtual:hibi-addon-catalog/details'
  )
  for (const key of Object.keys(previous))
    delete (previous as unknown as Record<string, unknown>)[key]
  Object.assign(previous, manifest)
  details[manifest.id] = manifest.licenses
    ? { licenses: manifest.licenses }
    : {}
  return getAddonStates()
}
