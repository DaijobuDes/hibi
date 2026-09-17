import { basename } from 'node:path'
import { type BrowserWindow, shell } from 'electron'
import { MAX_DOCUMENT_BYTES } from '../shared/desktop'
import {
  confirmDiscard,
  getDocument,
  getDocumentPath,
  importDocument,
  loadDocument,
} from './document'
import { documentMediaPath } from './images'

function webUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 8192)
    throw new Error('enter an http or https url.')
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('use an http or https url without embedded credentials.')
  return url
}

export async function openDocumentLink(
  window: BrowserWindow,
  href: unknown,
  revision: unknown,
) {
  if (
    typeof href !== 'string' ||
    href.length > 8192 ||
    revision !== getDocument().revision
  )
    return null
  if (/^https?:/i.test(href)) {
    await shell.openExternal(webUrl(href).href)
    return null
  }
  if (/^mailto:/i.test(href)) {
    await shell.openExternal(new URL(href).href)
    return null
  }
  const path = documentMediaPath(href.split('#')[0]!, getDocumentPath())
  if (!path || !/\.(md|markdown|txt)$/i.test(path))
    throw new Error('only web, email, and markdown links can be opened.')
  if (path === getDocumentPath()) return getDocument()
  if (!(await confirmDiscard(window))) return null
  return loadDocument(window, path)
}

/** Import text only; no page scripts, cookies, or remote writes. */
export async function openRemoteDocument(
  window: BrowserWindow,
  value: unknown,
) {
  let url = webUrl(value)
  const current = getDocument()
  const signal = AbortSignal.timeout(20000)
  let response: Response | undefined
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(url, {
      signal,
      redirect: 'manual',
      headers: { Accept: 'text/markdown, text/plain;q=0.9' },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location || redirects === 5)
      throw new Error('too many redirects or a missing redirect destination.')
    url = webUrl(new URL(location, url).href)
  }
  if (!response?.ok || !response.body)
    throw new Error(
      `could not open remote document (${response?.status ?? 'no response'}).`,
    )
  if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
    await response.body.cancel()
    throw new Error('this url is a web page. use the raw markdown file url.')
  }
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_DOCUMENT_BYTES)
        throw new Error('remote documents must be under 2 mib.')
      parts.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const content = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(Buffer.concat(parts))
  if (
    current.revision !== getDocument().revision ||
    current.markdown !== getDocument().markdown
  )
    throw new Error('the note changed while downloading; try again.')
  if (!(await confirmDiscard(window))) return null
  let name =
    basename(decodeURIComponent(url.pathname))
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
      .slice(0, 160) || 'remote.md'
  if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md'
  return importDocument(window, content, name)
}
