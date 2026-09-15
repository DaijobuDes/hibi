import { randomUUID } from 'node:crypto'
import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { MAX_DOCUMENT_BYTES } from '../shared/desktop'

// ponytail: cap documents at 2 MiB; move parsing off-thread before raising this.

export function validateMarkdown(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES
  ) {
    throw new Error('documents must be utf-8 text under 2 mib.')
  }
}

export async function readMarkdown(path: string): Promise<string> {
  if ((await stat(path)).size > MAX_DOCUMENT_BYTES)
    throw new Error('this document is larger than 2 mib.')
  const bytes = await readFile(path)
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error('this document is larger than 2 mib.')
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    bytes,
  )
}

export async function writeMarkdown(
  path: string,
  markdown: string,
): Promise<void> {
  validateMarkdown(markdown)
  return writeText(path, markdown)
}

export async function writeText(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  const existing = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  try {
    const file = await open(temp, 'wx', existing?.mode ?? 0o600)
    try {
      await file.writeFile(text, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temp, path)
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
