import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { download } from '../src/main/download.ts'

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
