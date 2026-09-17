import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { type BrowserWindow, dialog } from 'electron'
import type { AttachmentResult, DocumentMedia } from '../shared/media'
import {
  confirmDiscard,
  getDocument,
  getDocumentPath,
  loadDocument,
  saveDocument,
} from './document'
import { isDocumentName } from './document-types'
import {
  imageMime,
  readDocumentImage,
  resolveDocumentMediaPath,
} from './images'
import { loadWorkspace, workspaceRoot } from './workspace'

const extensions = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'ogv',
]
const videos = new Map<
  string,
  { path: string; note: string | null; revision: number }
>()

function videoMime(bytes: Buffer) {
  if (
    bytes.toString('ascii', 4, 8) === 'ftyp' &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V |qt {2}|dash)/.test(
      bytes.toString('ascii', 8, 12),
    )
  )
    return 'video/mp4'
  if (
    bytes.subarray(0, 4).toString('hex') === '1a45dfa3' &&
    bytes.includes(Buffer.from('webm'))
  )
    return 'video/webm'
  if (
    bytes.toString('ascii', 0, 4) === 'OggS' &&
    bytes.includes(Buffer.from('theora'))
  )
    return 'video/ogg'
  return null
}

function filePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.length > 8192 ||
    /[\0\r\n]/.test(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//')
  )
    throw new Error('drop a file from your file manager.')
  return value
}

async function openMedia(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const stat = await file.stat()
    if (!stat.isFile() || !stat.size || stat.size > 512 * 1024 * 1024)
      throw new Error('media must be a regular file under 512 mib.')
    const header = Buffer.alloc(Math.min(4096, stat.size))
    await file.read(header, 0, header.length, 0)
    const mime = imageMime(header) ?? videoMime(header)
    if (!mime) throw new Error('choose a supported image, gif, or video.')
    if (mime.startsWith('image/') && stat.size > 8 * 1024 * 1024)
      throw new Error('images must be under 8 mib.')
    return { file, stat, mime }
  } catch (error) {
    await file.close()
    throw error
  }
}

export async function openDroppedFile(window: BrowserWindow, value: unknown) {
  const path = await realpath(filePath(value))
  if ((await lstat(path)).isDirectory())
    return { workspace: await loadWorkspace(path), document: getDocument() }
  if (!isDocumentName(path))
    throw new Error(
      'drop a markdown file or folder to open it; drop media onto the editor to attach it.',
    )
  if (path === getDocumentPath()) return { document: getDocument() }
  if (!(await confirmDiscard(window))) return null
  return { document: await loadDocument(window, path) }
}

export async function attachMedia(
  window: BrowserWindow,
  values: unknown,
  revision: unknown,
): Promise<AttachmentResult | null> {
  if (revision !== getDocument().revision)
    throw new Error('the note changed; try attaching again.')
  if (values === null) {
    const result = await dialog.showOpenDialog(window, {
      title: 'attach image or video',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'images and videos', extensions }],
    })
    if (result.canceled) return null
    values = result.filePaths
  }
  if (!Array.isArray(values) || !values.length || values.length > 32)
    throw new Error('choose up to 32 media files.')
  const paths = values.map(filePath)
  // Validate the whole selection before prompting to save or creating attachments.
  for (const path of paths) await (await openMedia(path)).file.close()
  if (!getDocumentPath() || getDocument().ephemeral) {
    if (!(await saveDocument(window))) return null
  }
  if (revision !== getDocument().revision)
    throw new Error('the note changed; try attaching again.')
  const note = getDocumentPath()!
  const directory = join(dirname(note), 'assets')
  await mkdir(directory, { recursive: true })
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error(
      'the assets folder must be beside this note, without symlinks.',
    )
  const created: string[] = []
  try {
    const attachments = []
    for (const path of paths) {
      const { file, stat, mime } = await openMedia(path)
      try {
        const suffix =
          mime === 'image/svg+xml'
            ? '.svg'
            : mime === 'video/ogg'
              ? '.ogv'
              : `.${mime.split('/')[1]}`
        const stem =
          basename(path, extname(path))
            .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
            .slice(0, 80) || 'attachment'
        let name = stem + suffix
        let target: FileHandle
        for (let index = 2; ; index++) {
          try {
            target = await open(join(directory, name), 'wx')
            break
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            name = `${stem}-${index}${suffix}`
          }
        }
        created.push(join(directory, name))
        try {
          const output = target.createWriteStream()
          await pipeline(
            file.createReadStream({ start: 0, end: stat.size - 1 }),
            output,
          )
          if (output.bytesWritten !== stat.size)
            throw new Error('the attachment changed while copying; try again.')
        } finally {
          await target.close()
        }
        attachments.push({
          url: `assets/${encodeURIComponent(name)}`,
          alt: basename(path, extname(path)),
        })
      } finally {
        await file.close()
      }
    }
    if (getDocumentPath() !== note || getDocument().revision !== revision)
      throw new Error('the note changed; try attaching again.')
    return { document: getDocument(), attachments }
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path)))
    throw error
  }
}

export async function readDocumentMedia(
  source: string,
  revision: number,
): Promise<DocumentMedia | null> {
  const note = getDocumentPath()
  const path = await resolveDocumentMediaPath(source, note, workspaceRoot())
  if (!path || revision !== getDocument().revision) return null
  try {
    const { file, mime } = await openMedia(path)
    await file.close()
    if (mime.startsWith('image/')) {
      const url = await readDocumentImage(source, note, workspaceRoot())
      return url &&
        note === getDocumentPath() &&
        revision === getDocument().revision
        ? { kind: 'image', url }
        : null
    }
    for (const [token, entry] of videos)
      if (entry.note !== note || entry.revision !== revision)
        videos.delete(token)
    let token = [...videos].find(([, entry]) => entry.path === path)?.[0]
    if (!token) {
      if (videos.size >= 256) videos.delete(videos.keys().next().value!)
      token = randomUUID()
      videos.set(token, { path, note, revision })
    }
    return { kind: 'video', url: `app://hibi/document-media/${token}` }
  } catch {
    return null
  }
}

/** Stream only validated media, scoped to the active note; support seeking without base64 copies. */
export async function serveDocumentMedia(request: Request): Promise<Response> {
  const entry = videos.get(
    new URL(request.url).pathname.slice('/document-media/'.length),
  )
  if (
    !entry ||
    entry.note !== getDocumentPath() ||
    entry.revision !== getDocument().revision
  )
    return new Response(null, { status: 404 })
  const { file, stat, mime } = await openMedia(entry.path)
  if (!mime.startsWith('video/')) {
    await file.close()
    return new Response(null, { status: 404 })
  }
  let start = 0,
    end = stat.size - 1
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      start = match[1]
        ? Number(match[1])
        : Math.max(0, stat.size - Number(match[2]))
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end
    }
    if (
      !match ||
      !(match[1] || match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= stat.size
    ) {
      await file.close()
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      })
    }
  }
  const headers = new Headers({
    'Content-Type': mime,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  })
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  return new Response(
    Readable.toWeb(
      file.createReadStream({ start, end }),
    ) as ReadableStream<Uint8Array>,
    { status: range ? 206 : 200, headers },
  )
}

export async function exportDocumentMedia(
  source: string,
  note: string,
  workspacePath: string | null = null,
): Promise<string | null> {
  const path = await resolveDocumentMediaPath(source, note, workspacePath)
  if (!path) return null
  try {
    const { file, stat, mime } = await openMedia(path)
    try {
      if (stat.size > 14 * 1024 * 1024)
        throw new Error(
          'embedded media exceeds the 20 mib documentation export limit.',
        )
      const bytes = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead !== stat.size) return null
      return `data:${mime};base64,${bytes.subarray(0, bytesRead).toString('base64')}`
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('export limit'))
      throw error
    return null
  }
}
