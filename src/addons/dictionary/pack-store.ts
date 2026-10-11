import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { download } from '../../main/download.ts'
import { PackWorker } from './pack-runtime.ts'
import {
  type PackId,
  type PackManifest,
  type PackState,
  packId,
  packIds,
  packs,
  validateManifest,
} from './packs.ts'

async function directory(path: string, create = false) {
  path = resolve(path)
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('The dictionary pack location is not an ordinary folder.')
  return realpath(path)
}
async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
/** Only fixed language ids enter a path; the renderer never supplies filenames. */
export async function packDirectory(root: string, value: unknown) {
  const id = packId(value)
  const base = await directory(root, true)
  const path = join(base, id)
  if (await exists(path)) await directory(path)
  return path
}
async function regularFile(path: string, maxBytes: number) {
  const info = await lstat(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > maxBytes
  )
    throw new Error('This dictionary pack is damaged. Install it again.')
  return info
}
async function manifestAt(path: string, id: PackId) {
  await directory(path)
  await regularFile(join(path, 'manifest.json'), 64 * 1024)
  return validateManifest(
    JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')),
    id,
  )
}
async function verifyFile(
  path: string,
  expected: { bytes: number; sha256: string },
) {
  const info = await regularFile(path, expected.bytes)
  if (info.size !== expected.bytes)
    throw new Error('This dictionary pack is incomplete. Install it again.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== expected.sha256)
    throw new Error(
      'This dictionary pack failed its checksum. Install it again.',
    )
}

/** Download state lives in main; conversion and loaded indexes live in a bounded worker. */
export class PackStore {
  private worker: PackWorker
  private verified = new Map<
    PackId,
    { stamp: string; generation: number; pending: Promise<void> }
  >()
  private active:
    | { id: PackId; controller: AbortController; done: Promise<void> }
    | undefined
  private progress = new Map<PackId, PackState>()
  private busy = false
  private closed = false
  private generation = 0
  private recovered = new Map<PackId, Promise<void>>()

  constructor(
    private root: string,
    workerPath: string | URL,
    private fetcher?: typeof fetch,
  ) {
    this.worker = new PackWorker(workerPath)
  }

  private async recover(id: PackId) {
    let recovery = this.recovered.get(id)
    if (!recovery) {
      recovery = (async () => {
        const path = await packDirectory(this.root, id)
        const base = await directory(this.root)
        const scratch = join(base, `.install-${id}`)
        if (await exists(scratch)) {
          await directory(scratch)
          await rm(scratch, { recursive: true })
        }
        const previous = join(base, `.previous-${id}`)
        if (await exists(previous)) {
          await directory(previous)
          if (!(await exists(path))) await rename(previous, path)
          else await rm(previous, { recursive: true })
        }
      })().catch((error) => {
        this.recovered.delete(id)
        throw error
      })
      this.recovered.set(id, recovery)
    }
    await recovery
    return packDirectory(this.root, id)
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Dictionary packs are closed.')
  }

  async list(): Promise<PackState[]> {
    this.ensureOpen()
    return Promise.all(
      packIds.map(async (id) => {
        const progress = this.progress.get(id)
        if (progress) return progress
        try {
          const path = await this.recover(id)
          const manifest = (await exists(path))
            ? await manifestAt(path, id)
            : null
          return {
            id,
            manifest,
            phase: manifest ? 'installed' : 'absent',
            bytes: 0,
            total: null,
            entries: 0,
          }
        } catch {
          return {
            id,
            manifest: null,
            phase: 'error',
            bytes: 0,
            total: null,
            entries: 0,
            error: 'This dictionary pack is damaged. Install it again.',
          }
        }
      }),
    )
  }

  async install(value: unknown) {
    const id = packId(value)
    this.ensureOpen()
    if (this.busy)
      throw new Error(
        'Wait for the current dictionary pack operation to finish.',
      )
    this.busy = true
    this.generation++
    const controller = new AbortController()
    const state: PackState = {
      id,
      manifest: null,
      phase: 'downloading',
      bytes: 0,
      total: null,
      entries: 0,
    }
    this.progress.set(id, state)
    const done = this.performInstall(id, controller.signal, state)
      .catch((error) => {
        if (controller.signal.aborted) this.progress.delete(id)
        else
          this.progress.set(id, {
            ...state,
            phase: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Could not install this dictionary pack.',
          })
      })
      .finally(() => {
        this.active = undefined
        this.busy = false
      })
    this.active = { id, controller, done }
  }

  private async performInstall(
    id: PackId,
    cancel: AbortSignal,
    state: PackState,
  ) {
    const path = await this.recover(id)
    state.manifest = (await exists(path))
      ? await manifestAt(path, id).catch(() => null)
      : null
    const base = await directory(this.root)
    const scratch = join(base, `.install-${id}`)
    const previous = join(base, `.previous-${id}`)
    if (await exists(scratch)) {
      await directory(scratch)
      await rm(scratch, { recursive: true })
    }
    await mkdir(scratch, { mode: 0o700 })
    const signal = AbortSignal.any([
      cancel,
      AbortSignal.timeout(15 * 60 * 1000),
    ])
    try {
      const sources: PackManifest['sources'] = []
      const files: string[] = []
      let downloaded = 0
      for (const [i, source] of packs[id].sources.entries()) {
        const file = join(scratch, `source-${i}`)
        const handle = await open(file, 'wx', 0o600)
        try {
          const result = await download(source.url, {
            maxBytes: source.maxBytes,
            allowedOrigins: [new URL(source.url).origin],
            signal,
            ...(this.fetcher ? { fetch: this.fetcher } : {}),
            write: async (chunk) => {
              await handle.writeFile(chunk)
            },
            progress: (bytes, total) => {
              state.bytes = downloaded + bytes
              state.total =
                total === null
                  ? null
                  : downloaded +
                    total +
                    packs[id].sources
                      .slice(i + 1)
                      .reduce((sum, item) => sum + item.bytes, 0)
            },
          })
          sources.push({
            ...source,
            bytes: result.bytes,
            sha256: result.sha256,
            lastModified: result.lastModified,
          })
          downloaded += result.bytes
          files.push(file)
        } finally {
          await handle.close()
        }
      }
      state.phase = 'converting'
      state.total = state.bytes
      // ponytail: local conversion avoids hosted data; use hosted prebuilt packs if conversion becomes too slow.
      const result = await this.worker.convert(
        id,
        files,
        scratch,
        signal,
        (entries) => {
          state.entries = entries
        },
      )
      signal.throwIfAborted()
      const manifest = validateManifest(
        {
          format: 1,
          id,
          installedAt: new Date().toISOString(),
          sources,
          ...result,
        },
        id,
      )
      await writeFile(
        join(scratch, 'manifest.json'),
        JSON.stringify(manifest),
        { flag: 'wx', mode: 0o600 },
      )
      for (const file of files) await rm(file)
      await this.worker.unload()
      signal.throwIfAborted()
      if (await exists(path)) await rename(path, previous)
      try {
        await rename(scratch, path)
      } catch (error) {
        if (await exists(previous)) await rename(previous, path)
        throw error
      }
      this.verified.delete(id)
      if (await exists(previous)) await rm(previous, { recursive: true })
      this.progress.delete(id)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  async cancel(value: unknown) {
    const id = packId(value)
    if (this.active?.id !== id) return
    this.active.controller.abort(
      new Error('Dictionary pack installation canceled.'),
    )
    await this.active.done
  }

  async uninstall(value: unknown) {
    const id = packId(value)
    this.ensureOpen()
    if (this.busy)
      throw new Error(
        'Wait for the current dictionary pack operation to finish.',
      )
    this.busy = true
    this.generation++
    try {
      const path = await this.recover(id)
      await this.worker.unload()
      if (await exists(path)) await rm(path, { recursive: true })
      this.verified.delete(id)
      this.progress.delete(id)
    } finally {
      this.busy = false
    }
  }

  async lookup(id: PackId, word: string) {
    this.ensureOpen()
    if (this.busy) return []
    const generation = this.generation
    const changed = () =>
      this.closed || this.busy || generation !== this.generation
    try {
      const path = await this.recover(id)
      if (!(await exists(path))) return []
      const manifest = await manifestAt(path, id)
      if (changed()) return []
      let verification = this.verified.get(id)
      if (
        verification?.stamp !== manifest.installedAt ||
        verification.generation !== generation
      ) {
        const pending = (async () => {
          await verifyFile(join(path, 'data.jsonl'), manifest.data)
          await verifyFile(join(path, 'index.json'), manifest.index)
        })()
        verification = { stamp: manifest.installedAt, generation, pending }
        const current = verification
        this.verified.set(id, current)
        void pending.catch(() => {
          if (this.verified.get(id) === current) this.verified.delete(id)
        })
      }
      await verification.pending
      if (changed()) return []
      const entries = await this.worker.lookup(id, path, word)
      return changed() ? [] : entries
    } catch (error) {
      if (changed()) return []
      throw error
    }
  }

  async close() {
    this.closed = true
    this.generation++
    this.active?.controller.abort(
      new Error('Dictionary pack installation canceled.'),
    )
    await this.active?.done
    await this.worker.close()
  }
}
