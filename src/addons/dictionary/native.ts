import { join } from 'node:path'
import { app } from 'electron'
import type { NativeAddon } from '../api'
import manifest from './manifest'
import { completionLimit, completionPrefix } from './pack-runtime'
import { PackStore } from './pack-store'
import { lookupInput, packId } from './packs'

let current: PackStore | undefined
let closing = Promise.resolve()
async function store() {
  await closing
  current ??= new PackStore(
    join(app.getPath('userData'), 'dictionary-packs'),
    join(app.getAppPath(), 'out/main/dictionary-pack-worker.js'),
  )
  return current
}
function stop() {
  if (!current) return
  closing = current
    .close()
    .catch((error) => console.error('could not close dictionary packs:', error))
  current = undefined
}
app.on('before-quit', stop)

export default {
  id: manifest.id,
  stop,
  queries: {
    packs: async () => (await store()).list(),
    preloadPacks: async (input) => (await store()).preloadInstalled(input),
    async packComplete(input) {
      if (!input || typeof input !== 'object')
        throw new Error('Invalid dictionary completion')
      const { id, prefix, limit } = input as Record<string, unknown>
      return (await store()).complete(
        packId(id),
        completionPrefix(prefix),
        completionLimit(limit),
      )
    },
    packInstalled: async (input) => (await store()).installed(input),
    async packLookup(input) {
      const { id, word } = lookupInput(input)
      return (await store()).lookup(id, word)
    },
  },
  methods: {
    installPack: async (input) => (await store()).install(input),
    cancelPack: async (input) => (await store()).cancel(input),
    uninstallPack: async (input) => (await store()).uninstall(input),
  },
} satisfies NativeAddon
