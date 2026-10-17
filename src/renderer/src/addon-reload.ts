import type { AddonManifest } from '../../addons/api'
import { addonDependents } from '../../shared/addon-dependencies'

export type AddonReloadResult =
  | { status: 'reloaded' | 'idle' | 'superseded' }
  | { status: 'refused' | 'failed'; reason: string }

/**
 * Stop running addons and their running required consumers, consumers first,
 * then wait for the host's start effect to restart them provider-first.
 * Enabled settings are never written. A newer reload of any affected addon
 * supersedes this one; its discarded starts clean up through `stop`.
 * `reviewed` skips the window and settings checks for a replacement the user
 * confirmed, whose previous files are no longer served.
 */
export async function reloadAddons(
  ids: readonly string[],
  host: {
    /** The host's latest render, read again after each wait. */
    current: () => {
      catalog: readonly { manifest: AddonManifest }[]
      settled: ReadonlyMap<string, boolean>
      dependencies: ReadonlyMap<string, readonly string[]>
    }
    running: ReadonlyMap<string, { stop: () => void }>
    /** The newest reload of each addon. */
    reloads: Map<string, object>
    whenStarted: (id: string) => Promise<void>
    /** Clear committed start failures so the start effect tries these again. */
    retry: (ids: readonly string[]) => void
    settingsVisible: (id: string) => boolean
    reviewed?: boolean
  },
): Promise<AddonReloadResult> {
  const { running, reloads } = host
  const token = {}
  const manifests = host.current().catalog.map((addon) => addon.manifest)
  const name = (id = ids[0] ?? '') =>
    manifests.find((manifest) => manifest.id === id)?.name ?? id
  const closure = [
    ...new Set(ids.flatMap((id) => [id, ...addonDependents(manifests, id)])),
  ]
  // Addons a superseded reload is still restarting stay part of this one.
  const pending = closure.filter((id) => reloads.has(id))
  for (const id of closure) reloads.set(id, token)
  const superseded = () => closure.some((id) => reloads.get(id) !== token)
  const finish = (result: AddonReloadResult) => {
    for (const id of closure) if (reloads.get(id) === token) reloads.delete(id)
    return result
  }
  if (!host.reviewed) {
    const visible = closure.find(host.settingsVisible)
    if (visible)
      return finish({
        status: 'refused',
        reason: `Leave the ${name(visible)} settings before reloading ${name()}.`,
      })
    const owners = await window.hibi.getAddonWindowOwners()
    const windowed = closure.find((id) => owners.includes(id))
    if (windowed)
      return finish({
        status: 'refused',
        reason: `Close the ${name(windowed)} windows before reloading ${name()}.`,
      })
    if (superseded()) return finish({ status: 'superseded' })
  }
  // A reload is an explicit retry: failed addons in the closure and their required providers start again.
  const { settled, dependencies } = host.current()
  const retried = [
    ...new Set([
      ...ids.flatMap((id) => dependencies.get(id) ?? []),
      ...closure,
    ]),
  ].filter((id) => settled.get(id) === false)
  const restarting = [
    ...new Set([
      ...closure.filter((id) => running.has(id)),
      ...pending,
      ...retried,
    ]),
  ]
  if (!restarting.length) return finish({ status: 'idle' })
  for (const id of ids) running.get(id)?.stop()
  if (retried.length) host.retry(retried)
  const outcomes = await Promise.allSettled(restarting.map(host.whenStarted))
  if (superseded()) return finish({ status: 'superseded' })
  const failed = restarting.filter(
    (_, index) => outcomes[index]?.status === 'rejected',
  )
  return finish(
    failed.length
      ? {
          status: 'failed',
          reason: `${failed.map(name).join(', ')} could not restart.`,
        }
      : { status: 'reloaded' },
  )
}
