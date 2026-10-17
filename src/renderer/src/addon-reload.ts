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
    affectsEditor: (ids: readonly string[]) => boolean
    /** Keep editors read-only until the returned function runs. */
    readOnly: () => () => void
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
  let editable: (() => void) | undefined
  const finish = (result: AddonReloadResult) => {
    for (const id of closure) if (reloads.get(id) === token) reloads.delete(id)
    for (const id of restarting)
      if (restarts.get(id) === token) restarts.delete(id)
    editable?.()
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
  if (host.affectsEditor(closure)) {
    // Editing pauses until the restarted addons settle; then selection and focus return.
    const restore = keepEditorState(host.activeView)
    const end = host.readOnly()
    editable = () => void restore().finally(end)
  }
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

const frame = () => new Promise(requestAnimationFrame)

/** Text length from the start of `root` to a page position, stable across a rebuilt editor. */
const textOffset = (root: Element, node: Node, offset: number) => {
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return range.toString().length
}
const textPoint = (root: Element, offset: number): [Node, number] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return [node, remaining]
    remaining -= length
  }
  return [root, root.childNodes.length]
}
const moves = /^(?:Arrow|Home$|End$|Page)/

/**
 * Capture the active editor's selection and focus; the returned function puts
 * them back once the editor current then has loaded the document, waiting a
 * few frames for a rebuilt editor. A selection the user picks meanwhile is
 * read from the page when they pick it and wins, also when the editor is
 * rebuilt afterwards; editor notifications and their order are not trusted.
 */
function keepEditorState(activeView: () => ViewTarget | null) {
  const view = activeView()
  const start = view ? editorViewRegistry.getSelection(view) : null
  if (!view || !start?.ok) return async () => {}
  // A remounted editor registers a new view generation for the same document.
  const read = () => {
    const current = activeView()
    return current?.documentId === view.documentId &&
      current.documentGeneration === view.documentGeneration
      ? editorViewRegistry.getSelection(current)
      : null
  }
  const active = document.activeElement
  const focused = active instanceof HTMLElement && active.isContentEditable
  const surface = `.editor-panes :is(.rich-pane, .source-pane):not([inert]) ${start.value.editor === 'rich' ? '.ProseMirror' : '.cm-content'}`
  let chosen: { root: Element; anchor: number; focus: number } | undefined
  const choose = (event: Event) => {
    if (
      event instanceof KeyboardEvent &&
      !moves.test(event.key) &&
      !(event.key === 'a' && (event.metaKey || event.ctrlKey))
    )
      return
    const root =
      event.target instanceof Element
        ? event.target.closest('.ProseMirror, .cm-content')
        : null
    const selection = getSelection()
    if (
      !root?.matches(surface) ||
      !selection?.anchorNode ||
      !selection.focusNode ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    )
      return
    chosen = {
      root,
      anchor: textOffset(root, selection.anchorNode, selection.anchorOffset),
      focus: textOffset(root, selection.focusNode, selection.focusOffset),
    }
  }
  for (const type of ['pointerup', 'keyup'])
    window.addEventListener(type, choose, true)
  const focus = (root: HTMLElement | null) => {
    if (focused && document.activeElement === document.body)
      root?.focus({ preventScroll: true })
  }
  return async () => {
    // Let the restarted configuration render, including an editor it rebuilds.
    await frame()
    await frame()
    let current = read()
    for (let attempt = 0; !current?.ok && attempt < 120; attempt++) {
      await frame()
      current = read()
    }
    for (const type of ['pointerup', 'keyup'])
      window.removeEventListener(type, choose, true)
    if (chosen) {
      // The user's choice stands; a rebuilt editor gets the same text range back.
      if (chosen.root.isConnected) return focus(document.querySelector(surface))
      const needed = Math.max(chosen.anchor, chosen.focus)
      let root = document.querySelector<HTMLElement>(surface)
      for (
        let attempt = 0;
        (root?.textContent?.length ?? 0) < needed && attempt < 120;
        attempt++
      ) {
        await frame()
        root = document.querySelector<HTMLElement>(surface)
      }
      if (!root) return
      focus(root)
      getSelection()?.setBaseAndExtent(
        ...textPoint(root, chosen.anchor),
        ...textPoint(root, chosen.focus),
      )
      return
    }
    if (
      current?.ok &&
      current.value.editor === start.value.editor &&
      current.value.contentVersion === start.value.contentVersion
    )
      editorViewRegistry.setSelection({
        ...current.value,
        anchor: start.value.anchor,
        head: start.value.head,
      })
    focus(document.querySelector(surface))
  }
}
