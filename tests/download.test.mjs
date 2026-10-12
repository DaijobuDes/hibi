import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { packs, validateManifest } from '../src/addons/dictionary/packs.ts'
import { download } from '../src/main/download.ts'
import { downloadUrl } from '../src/shared/addon-package.ts'

test('downloads stream bounded bytes, progress and checksums without credentials', async () => {
  const parts = []
  const progress = []
  const result = await download('https://example.test/pack', {
    maxBytes: 8,
    signal: new AbortController().signal,
    fetch: async (_url, options) => {
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'manual')
      return new Response('word', { headers: { 'content-length': '4' } })
    },
    write: (chunk) => parts.push(chunk),
    progress: (...value) => progress.push(value),
  })
  assert.equal(Buffer.concat(parts).toString(), 'word')
  assert.equal(result.sha256, createHash('sha256').update('word').digest('hex'))
  assert.equal(result.bytes, 4)
  assert.deepEqual(progress.at(-1), [4, 4])
})

test('downloads reject short bodies, streamed overflow and insecure redirects', async () => {
  const options = {
    maxBytes: 8,
    signal: new AbortController().signal,
    write: () => {},
  }
  for (const [response, pattern] of [
    [
      new Response('short', { headers: { 'content-length': '8' } }),
      /incomplete/,
    ],
    [new Response('123456789'), /limit/],
    [
      new Response(null, {
        status: 302,
        headers: { location: 'http://example.test/file' },
      }),
      /HTTPS/,
    ],
  ])
    await assert.rejects(
      download('https://example.test/file', {
        ...options,
        fetch: async () => response,
      }),
      pattern,
    )
})

test('dictionary downloads reject redirects outside the fixed source origins', async () => {
  const requests = []
  await assert.rejects(
    download('https://source.test/pack', {
      maxBytes: 16,
      allowedOrigins: ['https://source.test'],
      signal: new AbortController().signal,
      write: () => {},
      fetch: async (url) => {
        requests.push(url.href)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://other.test/pack' },
        })
      },
    }),
    /unapproved host/,
  )
  assert.deepEqual(requests, ['https://source.test/pack'])
})

test('download inactivity allows flowing bodies past the timeout duration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let body
  const parts = []
  const pending = download('https://example.test/file', {
    maxBytes: 8,
    signal: new AbortController().signal,
    stallTimeoutMs: 100,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            body = controller
          },
        }),
      ),
    write: (chunk) => parts.push(chunk),
  })
  await setImmediate()
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(80)
    body.enqueue(new Uint8Array([i]))
    await setImmediate()
  }
  body.close()
  assert.equal((await pending).bytes, 4)
  assert.equal(parts.length, 4)
})

test('download inactivity aborts stalled headers and bodies', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const headers of [true, false]) {
    let signal
    let canceled = false
    const pending = download('https://example.test/file', {
      maxBytes: 8,
      signal: new AbortController().signal,
      stallTimeoutMs: 100,
      fetch: async (_url, options) => {
        signal = options.signal
        if (headers) return new Promise(() => {})
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]))
            },
            cancel() {
              canceled = true
            },
          }),
        )
      },
      write: () => {},
    })
    const rejection = assert.rejects(pending, /download is incomplete/)
    await setImmediate()
    t.mock.timers.tick(100)
    await rejection
    assert.equal(signal.aborted, true)
    if (!headers) assert.equal(canceled, true)
  }
})

test('download deadlines scale by expected size and stop slow-drip bodies', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const expectedBytes of [50 * 1024, 100 * 1024]) {
    let body
    let signal
    let canceled = false
    let writes = 0
    const pending = download('https://example.test/file', {
      maxBytes: 1024 * 1024,
      expectedBytes,
      stallTimeoutMs: 60_000,
      signal: new AbortController().signal,
      fetch: async (_url, options) => {
        signal = options.signal
        return new Response(
          new ReadableStream({
            start(controller) {
              body = controller
            },
            cancel() {
              canceled = true
            },
          }),
        )
      },
      write: () => writes++,
    })
    const rejection = assert.rejects(pending, /download is incomplete/)
    await setImmediate()
    for (let i = 0; i < 6; i++) {
      t.mock.timers.tick(10_000)
      body.enqueue(new Uint8Array([1]))
      await setImmediate()
    }
    const allowance = (expectedBytes / (50 * 1024)) * 1000
    t.mock.timers.tick(allowance - 1)
    await setImmediate()
    assert.equal(signal.aborted, false)
    assert.equal(writes, 6)
    t.mock.timers.tick(1)
    await rejection
    assert.equal(signal.aborted, true)
    assert.equal(canceled, true)
  }
})

test('larger sources can finish after a minute while data keeps flowing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let body
  const pending = download('https://example.test/file', {
    maxBytes: 1024 * 1024,
    expectedBytes: 1024 * 1024,
    stallTimeoutMs: 60_000,
    signal: new AbortController().signal,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            body = controller
          },
        }),
      ),
    write: () => {},
  })
  await setImmediate()
  for (let i = 0; i < 7; i++) {
    t.mock.timers.tick(10_000)
    body.enqueue(new Uint8Array([1]))
    await setImmediate()
  }
  body.close()
  assert.equal((await pending).bytes, 7)
})

test('download deadline includes redirects and pending headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  let signal
  const pending = download('https://example.test/file', {
    maxBytes: 1024 * 1024,
    expectedBytes: 50 * 1024,
    signal: new AbortController().signal,
    write: () => assert.fail('unexpected write'),
    fetch: async (_url, options) => {
      signal = options.signal
      requests++
      if (requests === 1) {
        t.mock.timers.tick(30_000)
        return new Response(null, {
          status: 302,
          headers: { location: '/redirect' },
        })
      }
      return new Promise(() => {})
    },
  })
  const rejection = assert.rejects(pending, /download is incomplete/)
  await setImmediate()
  assert.equal(requests, 2)
  t.mock.timers.tick(30_999)
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(1)
  await rejection
  assert.equal(signal.aborted, true)
})

test('completed downloads clear deadline and stall timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  await download('https://example.test/file', {
    maxBytes: 8,
    expectedBytes: 50 * 1024,
    stallTimeoutMs: 60_000,
    signal: new AbortController().signal,
    fetch: async (_url, options) => {
      signal = options.signal
      return new Response('word')
    },
    write: () => {},
  })
  t.mock.timers.tick(120_000)
  assert.equal(signal.aborted, false)
})

test('cancellation aborts pending headers and body reads without a timeout', async () => {
  for (const headers of [true, false]) {
    const controller = new AbortController()
    let signal
    let canceled = false
    const pending = download('https://example.test/file', {
      maxBytes: 8,
      signal: controller.signal,
      fetch: async (_url, options) => {
        signal = options.signal
        if (headers) return new Promise(() => {})
        return new Response(
          new ReadableStream({
            cancel() {
              canceled = true
            },
          }),
        )
      },
      write: () => assert.fail('unexpected write'),
    })
    const rejection = assert.rejects(pending, /canceled/)
    await setImmediate()
    controller.abort(new Error('canceled'))
    await rejection
    assert.equal(signal.aborted, true)
    if (!headers) assert.equal(canceled, true)
  }
})

test('shared url validation and redirect errors use neutral download copy', async () => {
  assert.throws(() => downloadUrl(undefined), {
    message: 'Enter an HTTPS URL for the download.',
  })
  await assert.rejects(
    download('https://example.test/file', {
      maxBytes: 8,
      signal: new AbortController().signal,
      write: () => {},
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://example.test/file' },
        }),
    }),
    { message: 'Use an HTTPS URL without a username or password.' },
  )
})

test('gzip source manifests retain valid legacy jsonl installs within old bounds', () => {
  const file = { bytes: 1, sha256: 'a'.repeat(64) }
  for (const id of ['fr', 'tl']) {
    const source = packs[id].sources[0]
    assert.ok(source.url.endsWith('.jsonl.gz'))
    const manifest = {
      format: 1,
      id,
      installedAt: new Date().toISOString(),
      sources: [{ ...source, ...file, lastModified: null }],
      entries: 1,
      keys: 1,
      data: file,
      index: file,
      convertMs: 0,
    }
    assert.equal(validateManifest(manifest, id), manifest)
    const legacy = manifest.sources[0]
    legacy.url = source.url.slice(0, -3)
    legacy.bytes = (id === 'fr' ? 768 : 256) * 1024 * 1024
    assert.equal(validateManifest(manifest, id), manifest)
    legacy.bytes++
    assert.throws(() => validateManifest(manifest, id), /damaged or outdated/)
    legacy.bytes = source.maxBytes + 1
    legacy.url = source.url
    assert.throws(() => validateManifest(manifest, id), /damaged or outdated/)
  }
})

test('download cancellation stops before writing further bytes', async () => {
  const controller = new AbortController()
  let writes = 0
  await assert.rejects(
    download('https://example.test/file', {
      maxBytes: 8,
      signal: controller.signal,
      fetch: async () => new Response('word'),
      write: () => {
        writes++
        controller.abort(new Error('canceled'))
      },
    }),
    /canceled/,
  )
  assert.equal(writes, 1)
})
