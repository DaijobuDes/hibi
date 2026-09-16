import type { EditorKeyEvent } from '../../addons/api'

const listeners = new Set<(event: EditorKeyEvent) => void>()
export function onEditorKeyEvent(listener: (event: EditorKeyEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function emitEditorKeyEvent(event: KeyboardEvent) {
  if (!listeners.size) return
  const target = event.target
  if (
    !(target instanceof HTMLElement) ||
    event.isComposing ||
    target.closest('[inert]')
  )
    return
  const editor = target.closest<HTMLElement>(
    '.tiptap[contenteditable="true"], .cm-content[contenteditable="true"]',
  )
  if (!editor || document.querySelector('dialog[open]')) return
  const data: EditorKeyEvent = Object.freeze({
    phase: event.type === 'keyup' ? 'up' : 'down',
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    view: editor.classList.contains('cm-content') ? 'source' : 'normal',
  })
  for (const listener of listeners) listener(data)
}
