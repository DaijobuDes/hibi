import { createHash } from 'node:crypto'
import { addonPackageUrl } from '../shared/addon-package.ts'

/** Shared bounded HTTPS transport. Callers own their buffers or staging files. */
export async function download(
  source: string,
  options: {
    maxBytes: number
    signal: AbortSignal
    accept?: string
    write: (chunk: Uint8Array) => void | Promise<void>
    progress?: (bytes: number, total: number | null) => void
    fetch?: typeof fetch
  },
) {
  let url = addonPackageUrl(source)
  const request = options.fetch ?? fetch
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await request(url, {
      signal: options.signal,
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        Accept: options.accept ?? 'application/octet-stream',
        'Accept-Encoding': 'identity',
      },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirects === 5)
        throw new Error('The download redirects too many times.')
      url = addonPackageUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(
        `Could not download the file (${response.status}). Try again.`,
      )
    }
    const length = response.headers.get('content-length')
    const total = length === null ? null : Number(length)
    if (
      total !== null &&
      (!Number.isSafeInteger(total) || total < 0 || total > options.maxBytes)
    ) {
      await response.body.cancel()
      throw new Error(
        `The download exceeds the ${options.maxBytes / 1024 / 1024} MiB limit.`,
      )
    }
    const hash = createHash('sha256')
    const reader = response.body.getReader()
    let bytes = 0
    try {
      for (;;) {
        options.signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > options.maxBytes)
          throw new Error(
            `The download exceeds the ${options.maxBytes / 1024 / 1024} MiB limit.`,
          )
        hash.update(value)
        await options.write(value)
        options.progress?.(bytes, total)
      }
      if (
        !bytes ||
        (total !== null &&
          !response.headers.get('content-encoding') &&
          bytes !== total)
      )
        throw new Error('The download is incomplete. Try again.')
      options.signal.throwIfAborted()
      return {
        bytes,
        sha256: hash.digest('hex'),
        url: url.href,
        lastModified: response.headers.get('last-modified'),
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
  throw new Error('Could not download the file. Try again.')
}
