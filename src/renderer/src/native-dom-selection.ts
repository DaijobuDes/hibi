import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** A rendered widget's native DOM positions, in its owning document now. */
type DOMPositions = {
  view: EditorView
  read: (node: Node, offset: number) => number | null
}
const positions = new WeakMap<Node, DOMPositions>()

/** A widget keeps its source positions current and removes them when destroyed. */
export function registerDOMPositions(
  view: EditorView,
  root: Node,
  read: DOMPositions['read'],
) {
  const entry = { view, read }
  positions.set(root, entry)
  return () => {
    if (positions.get(root) === entry) positions.delete(root)
  }
}

export function readDOMPosition(view: EditorView, node: Node, offset: number) {
  if (!view.contentDOM.contains(node)) return null
  for (let root: Node | null = node; root; root = root.parentNode) {
    const entry = positions.get(root)
    if (entry?.view === view) {
      const at = entry.read(node, offset)
      return at !== null &&
        Number.isSafeInteger(at) &&
        at >= 0 &&
        at <= view.state.doc.length
        ? { at, mapped: true }
        : null
    }
    if (root === view.contentDOM) break
  }
  try {
    return { at: view.posAtDOM(node, offset), mapped: false }
  } catch {
    return null
  }
}

type Points = Pick<
  Selection,
  'anchorNode' | 'anchorOffset' | 'focusNode' | 'focusOffset'
>

const writable = (state: EditorState) =>
  !state.readOnly && state.facet(EditorView.editable)

/**
 * A read-only widget can hold a browser selection without editable DOM.
 * Keep that pick in the document too, so other views and a later unlock
 * read its positions. Native selections outside mapped widgets stay with
 * CodeMirror, and a newer interaction outside the view keeps its focus.
 */
export const nativeDOMSelection = ViewPlugin.fromClass(
  class {
    private armed = false
    private picked = false
    private destroyed = false
    private document: Document
    private view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.document = view.dom.ownerDocument
      for (const type of ['pointerdown', 'keydown'])
        view.dom.addEventListener(type, this.arm, true)
    }
    private clear() {
      if (!this.armed && !this.picked) return
      this.armed = this.picked = false
      this.document.removeEventListener('selectionchange', this.selection)
      this.document.defaultView?.removeEventListener('blur', this.intent)
      for (const type of ['pointerdown', 'keydown', 'focusin'])
        this.document.removeEventListener(type, this.intent, true)
    }
    private arm = () => {
      if (writable(this.view.state)) return this.clear()
      if (this.armed) return
      this.armed = true
      this.document.addEventListener('selectionchange', this.selection)
      this.document.defaultView?.addEventListener('blur', this.intent)
      for (const type of ['pointerdown', 'keydown', 'focusin'])
        this.document.addEventListener(type, this.intent, true)
    }
    private intent = (event: Event) => {
      if (event.type === 'focusin' && event.target === this.document.body)
        return
      if (
        !(event.target instanceof Node) ||
        !this.view.dom.contains(event.target)
      )
        this.clear()
    }
    private selection = () => this.read(this.document.getSelection())
    /** Keep a pick's points, as the page shows them now or showed them before an update. */
    private read(selection: Points | null) {
      const { view } = this
      if (!this.armed || writable(view.state)) return
      const active = this.document.activeElement
      if (active !== this.document.body && !view.dom.contains(active)) return
      if (!selection?.anchorNode || !selection.focusNode) return
      const anchor = readDOMPosition(
        view,
        selection.anchorNode,
        selection.anchorOffset,
      )
      const head = readDOMPosition(
        view,
        selection.focusNode,
        selection.focusOffset,
      )
      if (!anchor || !head || !(anchor.mapped || head.mapped)) return
      this.picked = true
      const current = view.state.selection.main
      if (current.anchor !== anchor.at || current.head !== head.at)
        view.dispatch({
          selection: EditorSelection.single(anchor.at, head.at),
          userEvent: 'select.pointer',
        })
    }
    update(update: ViewUpdate) {
      // CodeMirror writes its own selection to the page after this update,
      // over a pick whose selection change has not arrived yet.
      if (this.armed && !update.selectionSet && !writable(update.state)) {
        const selection = this.document.getSelection()
        const points = selection && {
          anchorNode: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focusNode: selection.focusNode,
          focusOffset: selection.focusOffset,
        }
        queueMicrotask(() => {
          if (!this.destroyed) this.read(points)
        })
      }
      if (!this.armed || !writable(update.state) || writable(update.startState))
        return
      if (!this.picked) return this.clear()
      queueMicrotask(() => {
        if (this.destroyed || !this.picked) return
        this.clear()
        const { view } = this
        const active = this.document.activeElement
        if (
          writable(view.state) &&
          view.dom.isConnected &&
          view.dom.checkVisibility({ visibilityProperty: true }) &&
          !view.dom.closest('[inert]') &&
          (active === this.document.body ||
            active === view.scrollDOM ||
            active === view.contentDOM)
        )
          view.focus()
      })
    }
    destroy() {
      this.destroyed = true
      this.clear()
      for (const type of ['pointerdown', 'keydown'])
        this.view.dom.removeEventListener(type, this.arm, true)
    }
  },
)
