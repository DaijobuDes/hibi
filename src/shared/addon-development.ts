import type { AddonManifest } from '../addons/api'

/** Changes to activation, permissions, or native contracts need the guarded restart. */
export function addonDevelopmentManifestContract(
  manifest: AddonManifest,
  native: boolean,
) {
  return JSON.stringify([
    manifest.kind,
    manifest.capabilities,
    manifest.network,
    manifest.requires,
    manifest.dependencies,
    manifest.fileExtensions,
    manifest.importer,
    manifest.analysis,
    manifest.defaultEnabled,
    manifest.activation,
    manifest.startup,
    manifest.commands,
    manifest.syntax,
    native && manifest.fileExtensions?.length ? manifest.name : undefined,
  ])
}
