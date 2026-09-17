import { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { markdownPositions } from './markdown-positions'

/** Markdown follows text positions; other preview formats keep proportional scrolling. */
export function linkScroll(
  first: HTMLElement,
  second: HTMLElement,
  initial: HTMLElement,
  markdown?: {
    editor: Editor
    content: () => { source: string; body: string }
  },
) {
  let leader = initial
  let frame = 0
  let refinements = 0
  const sourcePane = second.closest('.source-pane')
  let cached: {
    doc: Editor['state']['doc']
    body: string
    map: ReturnType<typeof markdownPositions>
  } | null = null
  function anchoredTop(target: HTMLElement): number | null {
    if (!markdown || markdown.editor.isDestroyed) return null
    const content = second.querySelector<HTMLElement>('.cm-content')
    const view = content && EditorView.findFromDOM(content)
    if (!view) return null
    const editor = markdown.editor
    const text = markdown.content()
    const offset = text.source.lastIndexOf(text.body)
    if (offset < 0) return null
    if (!cached || cached.doc !== editor.state.doc || cached.body !== text.body)
      cached = {
        doc: editor.state.doc,
        body: text.body,
        map: markdownPositions(text.body, editor.state.doc),
      }
    const bounds = leader.getBoundingClientRect()
    const visible = (point: { top: number; bottom: number } | null) =>
      point && point.top >= bounds.top && point.bottom <= bounds.bottom
    let position: number, point: { top: number; bottom: number } | null
    if (leader === second) {
      position = view.state.selection.main.head
      point = view.hasFocus ? view.coordsAtPos(position) : null
      if (!visible(point)) {
        position =
          view.posAtCoords({
            x: view.contentDOM.getBoundingClientRect().left + 8,
            y: bounds.top + bounds.height / 2,
          }) ?? position
        point = view.coordsAtPos(position)
      }
      if (!point || position < offset) return null
      const mapped = cached.map(position - offset, 'source')
      if (mapped === null) return null
      const destination = editor.view.coordsAtPos(mapped)
      return (
        target.scrollTop +
        (destination.top + destination.bottom - point.top - point.bottom) / 2
      )
    }
    position = editor.state.selection.head
    point = editor.view.hasFocus() ? editor.view.coordsAtPos(position) : null
    if (!visible(point)) {
      position =
        editor.view.posAtCoords({
          left: editor.view.dom.getBoundingClientRect().left + 8,
          top: bounds.top + bounds.height / 2,
        })?.pos ?? position
      point = editor.view.coordsAtPos(position)
    }
    const mapped = cached.map(position, 'rich')
    if (mapped === null || !point) return null
    const at = Math.min(view.state.doc.length, mapped + offset)
    const destination = view.coordsAtPos(at)
    // Distant CodeMirror lines are virtualized. Estimate once, then refine after rendering.
    const y = destination
      ? (destination.top + destination.bottom) / 2
      : view.documentTop + view.lineBlockAt(at).top + view.defaultLineHeight / 2
    return target.scrollTop + y - (point.top + point.bottom) / 2
  }
  const sync = () => {
    frame = 0
    const target = leader === first ? second : first
    const range = leader.scrollHeight - leader.clientHeight
    const position = range > 0 ? leader.scrollTop / range : 0
    const top = markdown
      ? anchoredTop(target)
      : Math.max(0, Math.min(1, position)) *
        Math.max(0, target.scrollHeight - target.clientHeight)
    if (top === null) return
    const clamped = Math.max(
      0,
      Math.min(top, target.scrollHeight - target.clientHeight),
    )
    if (Math.abs(target.scrollTop - clamped) < 1) return
    target.scrollTop = clamped
    if (markdown && refinements++ < 3) frame = requestAnimationFrame(sync)
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    refinements = 0
    frame = requestAnimationFrame(sync)
  }
  const scroll = (event: Event) => {
    const origin = event.currentTarget as HTMLElement
    // Virtualized source layout can emit several delayed scroll events. Only
    // direct input or focus changes may hand control to the other pane.
    if (origin !== leader) return
    schedule()
  }
  const intent = (event: Event) => {
    leader = event.currentTarget as HTMLElement
  }
  const selection = () => {
    const focused = document.activeElement
    if (first.contains(focused)) leader = first
    else if (second.contains(focused)) leader = second
    else return
    schedule()
  }
  const observer = new ResizeObserver(schedule)
  for (const pane of [first, second]) {
    pane.addEventListener('wheel', intent, { passive: true })
    pane.addEventListener('pointerdown', intent)
  }
  if (markdown) {
    observer.observe(markdown.editor.view.dom)
    const sourceContent = second.querySelector('.cm-content')
    if (sourceContent) observer.observe(sourceContent)
    document.addEventListener('selectionchange', selection)
    second.addEventListener('hibi:source-caret', selection)
    markdown.editor.on('transaction', selection)
  }
  first.addEventListener('scroll', scroll, { passive: true })
  second.addEventListener('scroll', scroll, { passive: true })
  const settled = () => schedule()
  // Widths settle during the view transition; new files are already at their final widths.
  first.addEventListener('transitionend', settled)
  sourcePane?.addEventListener('transitionend', settled)
  schedule()
  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    for (const pane of [first, second]) {
      pane.removeEventListener('wheel', intent)
      pane.removeEventListener('pointerdown', intent)
    }
    document.removeEventListener('selectionchange', selection)
    second.removeEventListener('hibi:source-caret', selection)
    markdown?.editor.off('transaction', selection)
    first.removeEventListener('scroll', scroll)
    second.removeEventListener('scroll', scroll)
    first.removeEventListener('transitionend', settled)
    sourcePane?.removeEventListener('transitionend', settled)
  }
}
