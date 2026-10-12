import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  datamuseProvider,
  wiktionaryProvider,
} from '../src/addons/dictionary/online.ts'
import { packs } from '../src/addons/dictionary/packs.ts'
import { HostNetwork } from '../src/main/host-network.ts'
import { parseAddonNetwork } from '../src/shared/host-network.ts'

const bundled = await build({
  entryPoints: [
    fileURLToPath(
      new URL('../src/addons/dictionary/manifest.ts', import.meta.url),
    ),
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const { default: manifest } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)

test('dictionary declares only its online lookup origins', () => {
  const { origins } = parseAddonNetwork(manifest.network)
  assert.deepEqual(origins, [
    'https://en.wiktionary.org',
    'https://api.datamuse.com',
  ])
})

test('dictionary online providers use declared hosts without permission prompts', async (t) => {
  const wiktionary = await readFile(
    new URL('./fixtures/dictionary/wiktionary-happy.json', import.meta.url),
    'utf8',
  )
  const windowKey = {}
  const requests = []
  const prompts = []
  const host = new HostNetwork({
    currentOwner: (id) =>
      id === manifest.id ? { addonId: id, activationGeneration: 1 } : null,
    declaredOrigins: (id) =>
      id === manifest.id ? manifest.network.origins : [],
    isWindowLive: (key) => key === windowKey,
    grantDestination: async (grant) => {
      prompts.push(grant)
      return false
    },
    grantPrivateAddress: async () =>
      assert.fail('public hosts need no private grant'),
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    transport: async (url) => {
      requests.push(url.href)
      const text =
        url.hostname === 'en.wiktionary.org' ? wiktionary : '[{"word":"glad"}]'
      return {
        status: 200,
        headers: {},
        body: Readable.from([Buffer.from(text)]),
      }
    },
  })
  t.after(() => host.dispose())
  const getText = (request) => host.request(manifest.id, windowKey, request)
  const signal = new AbortController().signal
  const dictionary = wiktionaryProvider(getText)
  assert.ok((await dictionary.lookup('happy', 'en', signal)).length)
  assert.ok((await dictionary.lookup('happy', 'de', signal)).length)
  assert.deepEqual(
    (await datamuseProvider(getText).related('happy', 'en', signal)).synonyms,
    ['glad'],
  )
  assert.equal(requests.length, 3)
  assert.deepEqual(prompts, [])
  assert.equal(
    (await getText({ url: 'https://example.org/undeclared' })).ok,
    false,
  )
  assert.equal(prompts.length, 1)
  const packOrigins = new Set(
    Object.values(packs).flatMap((pack) =>
      pack.sources.map((source) => new URL(source.url).origin),
    ),
  )
  for (const origin of packOrigins)
    assert.equal((await getText({ url: origin })).ok, false)
  assert.equal(prompts.length, 1 + packOrigins.size)
  assert.equal(requests.length, 3)
})
