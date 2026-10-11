import { createHash } from 'node:crypto'
import { downloadUrl } from '../shared/addon-package.ts'

/** Shared bounded HTTPS transport. Callers own their buffers or staging files. */
export async function download(
  source: string,
  options: {
    maxBytes: number
    signal: AbortSignal
    accept?: string
    allowedOrigins?: readonly string[]
    write: (chunk: Uint8Array) => void | Promise<void>
    progress?: (bytes: number, total: number | null) => void
    fetch?: typeof fetch
    /** Maximum inactivity before headers or between nonempty body chunks. */
    stallTimeoutMs?: number
    /** Expected source size for a 50 KiB/s deadline plus one minute of margin. */
    expectedBytes?: number
    parseUrl?: (value: string) => URL
  },
) {
  const parseUrl = options.parseUrl ?? downloadUrl
  let url = parseUrl(source)
  const request = options.fetch ?? fetch
  const stalled = new AbortController()
  const signal = AbortSignal.any([options.signal, stalled.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = () => {
    clearTimeout(timer)
    if (options.stallTimeoutMs !== undefined)
      timer = setTimeout(
        () =>
          stalled.abort(new Error('The download is incomplete. Try again.')),
        options.stallTimeoutMs,
      )
  }
  const wait = async <T>(operation: Promise<T>): Promise<T> => {
    let abort!: () => void
    const canceled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
    try {
      return await Promise.race([operation, canceled])
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  signal.throwIfAborted()
  reset()
  const deadline =
    options.expectedBytes !== undefined || options.stallTimeoutMs !== undefined
      ? setTimeout(
          () =>
            stalled.abort(new Error('The download is incomplete. Try again.')),
          ((options.expectedBytes ?? options.maxBytes) / (50 * 1024)) * 1000 +
            60_000,
        )
      : undefined
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (
        options.allowedOrigins &&
        !options.allowedOrigins.includes(url.origin)
      )
        throw new Error('The download redirected to an unapproved host.')
      signal.throwIfAborted()
      const response = await wait(
        request(url, {
          signal,
          redirect: 'manual',
          credentials: 'omit',
          headers: {
            Accept: options.accept ?? 'application/octet-stream',
            'Accept-Encoding': 'identity',
          },
        }),
      )
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location || redirects === 5)
          throw new Error('The download redirects too many times.')
        url = parseUrl(new URL(location, url).href)
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
          signal.throwIfAborted()
          const { done, value } = await wait(reader.read())
          if (done) break
          if (value.length) reset()
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
        signal.throwIfAborted()
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
  } finally {
    clearTimeout(timer)
    clearTimeout(deadline)
  }
}
