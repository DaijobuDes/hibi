import type { AddonManifest } from '../../addons/api'
import { addonDependents } from '../../shared/addon-dependencies'
import type { ViewTarget } from '../../shared/foundation-contracts'
import { editorViewRegistry } from './editor-view-api'

export type AddonReloadResult =
  | { status: 'reloaded' | 'idle' | 'superseded' }
  | { status: 'refused' | 'failed'; message: string }

/**
 * Stop running addons and their running required consumers, consumers first,
 * then wait for the host's start effect to restart them provider-first.
 * Enabled settings are never written. A newer reload of any affected addon
 * supersedes this one; its discarded starts clean up through `stop`.
 * `reviewed` skips the window and settings checks for a replacement the user
 * confirmed: main already refused it while those were open, and the previous
 * files are no longer served.
 */
export async function reloadAddons(
  ids: readonly string[],
  host: {
    /** The host's latest render, read again after each wait. */
    current: () => {
      catalog: readonly { manifest: AddonManifest }[]
      settled: ReadonlyMap<string, boolean>
      dependencies: ReadonlyMap<string, readonly string[]>
      /** Enabled addons that the current view or a request activates, with their providers. */
      relevantIds: ReadonlySet<string>
      windowBlocked: (id: string) => boolean
    }
    running: ReadonlyMap<string, { stop: () => void }>
    /** The newest reload of each addon. */
    reloads: Map<string, object>
    /** Addons a reload is waiting to see start again. */
    restarts: Map<string, object>
    whenStarted: (id: string) => Promise<void>
    /** Clear committed start failures so the start effect tries these again. */
    retry: (ids: readonly string[]) => void
    settingsVisible: (id: string) => boolean
    /** Keep editor configuration published as is until the returned release. */
    hold: () => () => void
    activeView: () => ViewTarget | null
    reviewed?: boolean
  },
): Promise<AddonReloadResult> {
  const { running, reloads, restarts } = host
  const token = {}
  const manifests = host.current().catalog.map((addon) => addon.manifest)
  const name = (id = ids[0] ?? '') =>
    manifests.find((manifest) => manifest.id === id)?.name ?? id
  const closure = [
    ...new Set(ids.flatMap((id) => [id, ...addonDependents(manifests, id)])),
  ]
  for (const id of closure) reloads.set(id, token)
  const superseded = () => closure.some((id) => reloads.get(id) !== token)
  let restarting: string[] = []
  let release: (() => void) | undefined
  let restoreEditor: (() => void) | undefined
  const finish = (result: AddonReloadResult) => {
    for (const id of closure) if (reloads.get(id) === token) reloads.delete(id)
    for (const id of restarting)
      if (restarts.get(id) === token) restarts.delete(id)
    // One publication of the restarted configuration, then the editor's selection and focus return.
    release?.()
    restoreEditor?.()
    return result
  }
  if (!host.reviewed) {
    const visible = closure.find(host.settingsVisible)
    if (visible)
      return finish({
        status: 'refused',
        message: `Leave the ${name(visible)} settings before reloading ${name()}.`,
      })
    const owners = await window.hibi.getAddonWindowOwners()
    const windowed = closure.find((id) => owners.includes(id))
    if (windowed)
      return finish({
        status: 'refused',
        message: `Close the ${name(windowed)} windows before reloading ${name()}.`,
      })
    if (superseded()) return finish({ status: 'superseded' })
  }
  // A reload is an explicit retry: failed addons in the closure and their required providers start again,
  // and so do consumers they were blocking. Addons that would not start now are not awaited.
  const { settled, dependencies, relevantIds, windowBlocked } = host.current()
  const retried = [
    ...new Set([
      ...closure.flatMap((id) => dependencies.get(id) ?? []),
      ...closure,
    ]),
  ].filter((id) => settled.get(id) === false)
  const unblocked = closure.filter((id) =>
    dependencies.get(id)?.some((provider) => retried.includes(provider)),
  )
  restarting = [
    ...new Set([
      ...closure.filter((id) => running.has(id) || restarts.has(id)),
      ...[...retried, ...unblocked].filter(
        (id) => relevantIds.has(id) && !windowBlocked(id),
      ),
    ]),
  ]
  for (const id of restarting) restarts.set(id, token)
  if (!restarting.length) return finish({ status: 'idle' })
  restoreEditor = keepEditorState(host.activeView())
  release = host.hold()
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
          message: `${failed.map(name).join(', ')} could not restart.`,
        }
      : { status: 'reloaded' },
  )
}

/**
 * Capture the active editor's selection and focus; the returned function puts
 * them back once that editor is current again. A rebuilt editor is restored
 * once per instance, so a rebuild after the final publication is covered too.
 * User input, an edit, or a short deadline ends the watch.
 */
function keepEditorState(view: ViewTarget | null) {
  const before = view ? editorViewRegistry.getSelection(view) : null
  if (!view || !before?.ok) return () => {}
  const active = document.activeElement
  const focused =
    active instanceof HTMLElement && active.isContentEditable ? active : null
  const pane = focused?.closest<HTMLElement>('.rich-pane, .source-pane')
  return () => {
    const deadline = performance.now() + 5000
    let restored = -1
    let frame = 0
    const stop = () => {
      cancelAnimationFrame(frame)
      for (const type of ['keydown', 'pointerdown', 'compositionstart'])
        window.removeEventListener(type, stop, true)
    }
    for (const type of ['keydown', 'pointerdown', 'compositionstart'])
      window.addEventListener(type, stop, true)
    const attempt = () => {
      if (performance.now() > deadline) return stop()
      frame = requestAnimationFrame(attempt)
      const current = editorViewRegistry.getSelection(view)
      if (!current.ok || current.value.editorGeneration === restored) return
      if (
        current.value.editor !== before.value.editor ||
        current.value.contentVersion !== before.value.contentVersion
      )
        return stop()
      const surface = focused?.isConnected
        ? focused
        : pane?.querySelector<HTMLElement>('[contenteditable="true"]')
      if (focused) {
        // Wait until the editor accepts input again.
        if (!surface?.isContentEditable || surface.closest('[inert]')) return
        if (document.activeElement === document.body)
          surface.focus({ preventScroll: true })
      }
      editorViewRegistry.setSelection({
        ...current.value,
        anchor: before.value.anchor,
        head: before.value.head,
      })
      restored = current.value.editorGeneration
    }
    attempt()
  }
}
