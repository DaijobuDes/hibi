let lastCopiedHtml = ''
let lastCopiedText = ''
export const trustedClipboardElements = new WeakSet<Element>()

/** Strip native clipboard envelopes without rewriting the fragment. */
export function clipboardHtml(html: string) {
  const fragment = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(
    html,
  )?.[1]
  if (fragment !== undefined) return fragment
  return html
    .replace(/^\s*<html\b[^>]*>([\s\S]*)<\/html>\s*$/i, '$1')
    .replace(/^\s*<head\b[^>]*>[\s\S]*?<\/head>/i, '')
    .replace(/^\s*<body\b[^>]*>([\s\S]*)<\/body>\s*$/i, '$1')
    .replace(/^(?:<meta\b[^>]*>)+/i, '')
}

/** Only the latest copy in this renderer can restore its original source. */
export function isCopiedHtml(html: string, text: string) {
  return (
    !!lastCopiedHtml &&
    clipboardHtml(html) === lastCopiedHtml &&
    text === lastCopiedText
  )
}

/** Read the final payload after the editor's copy, cut or drag handler. */
export function observeClipboard(dom: HTMLElement) {
  // Cut can detach its target before the event bubbles.
  const owned = new WeakSet<Event>()
  const capture = (event: Event) => {
    lastCopiedHtml = ''
    lastCopiedText = ''
    if (dom.contains(event.target as Node)) owned.add(event)
  }
  const remember = (event: Event) => {
    if (!owned.delete(event)) return
    const data =
      (event as ClipboardEvent).clipboardData ??
      (event as DragEvent).dataTransfer
    lastCopiedHtml = clipboardHtml(data?.getData('text/html') ?? '')
    lastCopiedText = lastCopiedHtml ? (data?.getData('text/plain') ?? '') : ''
  }
  const events = ['copy', 'cut', 'dragstart']
  const document = dom.ownerDocument
  for (const event of events) {
    document.addEventListener(event, capture, true)
    document.addEventListener(event, remember)
  }
  return () => {
    for (const event of events) {
      document.removeEventListener(event, capture, true)
      document.removeEventListener(event, remember)
    }
  }
}
