import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import { documentProject } from '../_shared/document-project'
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
const dependencies = new Map<string, Set<string>>()

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

function project(context: NativeAddonContext, epoch: number, id?: string) {
  return documentProject(context, {
    id,
    entry: 'untitled.typ',
    allowed,
    previousKey: fingerprint,
    paths: [...(dependencies.get(id ?? context.document.get().id) ?? [])],
    canceled: () => epoch !== generation,
  })
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
          join(app.getAppPath(), 'out/main/typst-worker.js'),
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
      let snapshot = await project(context, epoch, value.documentId)
      const dependencyKey = value.documentId ?? context.document.get().id
      const requested = dependencies.get(dependencyKey) ?? new Set<string>()
      if (dependencies.size >= 16 && !dependencies.has(dependencyKey))
        dependencies.clear()
      dependencies.set(dependencyKey, requested)
      let passes = 0
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
          const message = async (
            result: TypstResult & { pdf?: Uint8Array; missing?: string[] },
          ) => {
            const missing =
              result.missing?.filter((path) => !requested.has(path)) ?? []
            if (missing.length && passes++ < 64) {
              try {
                for (const path of missing) requested.add(path)
                snapshot = await project(context, epoch, value.documentId)
                if (epoch !== generation || child !== worker) return
                worker.postMessage({
                  sandbox: join(scratch, 'project'),
                  entry: snapshot.entry,
                  source: value.source,
                  block: value.block ?? false,
                  pdf: value.pdf ?? false,
                  ...(snapshot.files ? { files: snapshot.files } : {}),
                } satisfies CompileJob)
              } catch (error) {
                clean()
                reject(error)
              }
              return
            }
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
          worker.on('message', message)
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
