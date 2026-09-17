import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import type { NativeAddonContext } from '../api'
import type { TypstResult } from './types'

export type CompileJob = {
  sandbox: string
  entry: string
  source: string
  block: boolean
  pdf: boolean
  files?: [string, Uint8Array][]
}
type Input = {
  source: string
  documentId?: string
  block?: boolean
  pdf?: boolean
}
let child: UtilityProcess | null = null
let networkBlocker: Server | null = null
let scratch = ''
let fingerprint = ''
let generation = 0
let queued = 0
let tail: Promise<unknown> = Promise.resolve()
let cancel: (() => void) | undefined
const allowed =
  /\.(typ|typc|txt|md|markdown|json|yaml|yml|toml|csv|bib|xml|png|jpe?g|gif|webp|svg|avif|pdf|ttf|otf|ttc|otc|wasm)$/i
const ignored = new Set([
  'node_modules',
  'target',
  'out',
  'dist',
  'build',
  'release',
])
const within = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

function terminate(worker: UtilityProcess | null) {
  if (!worker) return
  // A synchronous native compile may never process SIGTERM; terminate only this owned utility process.
  if (worker.pid) {
    try {
      process.kill(worker.pid, 'SIGKILL')
    } catch {
      worker.kill()
    }
  } else worker.kill()
}

export function stopCompiler() {
  generation++
  cancel?.()
  terminate(child)
  child = null
  networkBlocker?.close()
  networkBlocker = null
  fingerprint = ''
  const previous = scratch
  scratch = ''
  if (previous)
    void rm(previous, { recursive: true, force: true }).catch(() => {})
}
app.on('before-quit', stopCompiler)

async function project(
  context: NativeAddonContext,
  epoch: number,
  id?: string,
) {
  const note = await context.document.path(id)
  const workspace = context.workspace.directory()
  const root = note
    ? workspace && within(workspace, note)
      ? workspace
      : dirname(note)
    : null
  const entry = root && note ? relative(root, note) : 'untitled.typ'
  const paths: {
    path: string
    name: string
    size: number
    modified: number
    changed: number
  }[] = []
  let bytes = 0
  let examined = 0
  async function walk(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (epoch !== generation) throw new Error('typst compilation canceled.')
      if (++examined > 10000)
        throw new Error('typst project is too large. open a smaller workspace.')
      if (
        item.name.startsWith('.') ||
        ignored.has(item.name) ||
        item.isSymbolicLink()
      )
        continue
      const path = join(directory, item.name)
      if ((await realpath(path)) !== path) continue
      if (item.isDirectory()) await walk(path)
      else if (item.isFile() && allowed.test(item.name)) {
        const info = await lstat(path)
        if (info.isSymbolicLink()) continue
        bytes += info.size
        if (paths.length >= 1000 || bytes > 64 * 1024 * 1024)
          throw new Error(
            'typst projects support up to 1,000 input files and 64 mib. open a smaller workspace.',
          )
        paths.push({
          path,
          name: relative(root!, path),
          size: info.size,
          modified: info.mtimeMs,
          changed: info.ctimeMs,
        })
      }
    }
  }
  if (root) await walk(root)
  const key = createHash('sha256')
    .update(JSON.stringify([root, paths]))
    .digest('hex')
  if (key === fingerprint) return { entry, key }
  const files: [string, Uint8Array][] = []
  for (const item of paths) {
    const file = await open(
      item.path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    )
    try {
      const info = await file.stat()
      if (
        !info.isFile() ||
        info.size !== item.size ||
        (await realpath(item.path)) !== item.path
      )
        throw new Error('typst input changed; try again.')
      const data = Buffer.alloc(item.size + 1)
      const { bytesRead } = await file.read(data, 0, data.length, 0)
      if (bytesRead !== item.size)
        throw new Error('typst input changed; try again.')
      files.push([item.name, data.subarray(0, bytesRead)])
    } finally {
      await file.close()
    }
  }
  return { entry, key, files }
}

export async function compileTypst(
  input: unknown,
  context: NativeAddonContext,
): Promise<TypstResult & { pdf?: Uint8Array }> {
  const value = input as Input | null
  if (
    !value ||
    typeof value.source !== 'string' ||
    Buffer.byteLength(value.source) > 2 * 1024 * 1024 ||
    (value.documentId !== undefined &&
      (typeof value.documentId !== 'string' ||
        value.documentId.length > 128)) ||
    (value.block !== undefined && typeof value.block !== 'boolean') ||
    (value.pdf !== undefined && typeof value.pdf !== 'boolean')
  )
    throw new Error('invalid typst input.')
  if (queued >= 16)
    throw new Error('typst compiler is busy. try again shortly.')
  queued++
  const epoch = generation
  const run = tail
    .catch(() => {})
    .then(async () => {
      if (epoch !== generation) throw new Error('typst compilation canceled.')
      if (!child) {
        const createdDirectory = await mkdtemp(join(tmpdir(), 'hibi-typst-'))
        if (epoch !== generation) {
          await rm(createdDirectory, { recursive: true, force: true })
          throw new Error('typst compilation canceled.')
        }
        scratch = createdDirectory
        await mkdir(join(scratch, 'project'))
        // Keep document-controlled package imports offline. The pinned compiler honors these proxy variables.
        const blocker = createServer((_request, response) => {
          response.writeHead(403)
          response.end()
        })
        blocker.on('connect', (_request, socket) =>
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'),
        )
        await new Promise<void>((resolve, reject) => {
          blocker.once('error', reject)
          blocker.listen(0, '127.0.0.1', resolve)
        })
        if (epoch !== generation) {
          blocker.close()
          await rm(createdDirectory, { recursive: true, force: true })
          throw new Error('typst compilation canceled.')
        }
        networkBlocker = blocker
        const address = blocker.address()
        if (!address || typeof address === 'string')
          throw new Error('could not isolate typst networking.')
        const proxy = `http://127.0.0.1:${address.port}`
        child = utilityProcess.fork(
          join(import.meta.dirname, 'typst-worker.js'),
          [],
          {
            serviceName: 'hibi typst',
            stdio: 'pipe',
            env: {
              ...process.env,
              HOME: join(app.getPath('userData'), 'typst'),
              TYPST_PACKAGE_CACHE_PATH: join(
                app.getPath('userData'),
                'typst',
                'packages',
              ),
              HTTP_PROXY: proxy,
              HTTPS_PROXY: proxy,
              ALL_PROXY: proxy,
              http_proxy: proxy,
              https_proxy: proxy,
              all_proxy: proxy,
              NO_PROXY: '',
              no_proxy: '',
            },
          },
        )
        child.stderr?.on('data', () => {})
        child.stdout?.on('data', () => {})
        child.on('error', () => {}) // The exit handler rejects the active job and permits a fresh worker.
        const created = child
        const directory = scratch
        child.once('exit', () => {
          blocker.close()
          if (networkBlocker === blocker) networkBlocker = null
          if (child === created) {
            child = null
            fingerprint = ''
            scratch = ''
          }
          void rm(directory, { recursive: true, force: true }).catch(() => {})
        })
        fingerprint = ''
      }
      const snapshot = await project(context, epoch, value.documentId)
      if (epoch !== generation || !child)
        throw new Error('typst compilation canceled.')
      const worker = child
      return new Promise<TypstResult & { pdf?: Uint8Array }>(
        (resolve, reject) => {
          const clean = () => {
            clearTimeout(timer)
            worker.removeListener('message', message)
            worker.removeListener('exit', exited)
            cancel = undefined
          }
          const exited = () => {
            clean()
            child = null
            fingerprint = ''
            reject(new Error('typst compiler stopped. try again.'))
          }
          const message = (result: TypstResult & { pdf?: Uint8Array }) => {
            clean()
            fingerprint = snapshot.key
            resolve(result)
          }
          cancel = () => {
            clean()
            reject(new Error('typst compilation canceled.'))
          }
          const timer = setTimeout(() => {
            clean()
            terminate(worker)
            child = null
            fingerprint = ''
            reject(
              new Error(
                'typst compilation timed out after 10 seconds. simplify the document and try again.',
              ),
            )
          }, 10000)
          worker.once('exit', exited)
          worker.once('message', message)
          worker.postMessage({
            sandbox: join(scratch, 'project'),
            entry: snapshot.entry,
            source: value.source,
            block: value.block ?? false,
            pdf: value.pdf ?? false,
            ...(snapshot.files ? { files: snapshot.files } : {}),
          } satisfies CompileJob)
        },
      )
    })
  tail = run
  try {
    return await run
  } finally {
    queued--
  }
}
