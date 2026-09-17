import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import { type CentralDirectory, Open } from 'unzipper'
import {
  addonPackageUrl,
  MAX_ADDON_BYTES,
  MAX_ADDON_ENTRIES,
  MAX_ADDON_FILE_BYTES,
  validAddonPath,
} from '../shared/addon-package.ts'

/** No cookies, credentials, or code execution; redirects must remain HTTPS. */
export async function downloadAddon(
  value: unknown,
): Promise<{ zip: Buffer; host: string }> {
  let url = addonPackageUrl(value)
  const signal = AbortSignal.timeout(20000)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, {
      signal,
      redirect: 'manual',
      headers: { Accept: 'application/zip' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location || redirects === 5)
        throw new Error('too many addon download redirects.')
      url = addonPackageUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(`could not download addon (${response.status}).`)
    }
    if (Number(response.headers.get('content-length')) > MAX_ADDON_BYTES) {
      await response.body.cancel()
      throw new Error('addon downloads must stay under 25 mib.')
    }
    const parts: Uint8Array[] = []
    let bytes = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > MAX_ADDON_BYTES)
          throw new Error('addon downloads must stay under 25 mib.')
        parts.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return { zip: Buffer.concat(parts), host: url.host }
  }
  throw new Error('could not download addon.')
}

/** Extract only bounded regular files into an owned, empty staging directory. */
export async function unpackAddon(
  zip: Buffer,
  destination: string,
): Promise<string> {
  if (zip.length > MAX_ADDON_BYTES || zip.length < 22)
    throw new Error('invalid addon zip package.')
  // Bound the central-directory parser before it allocates per-entry records.
  let end = zip.length - 22
  const minimum = Math.max(0, end - 65535)
  for (; end >= minimum; end--)
    if (
      zip.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + zip.readUInt16LE(end + 20) === zip.length
    )
      break
  if (
    end < minimum ||
    zip.readUInt16LE(end + 4) ||
    zip.readUInt16LE(end + 6) ||
    zip.readUInt16LE(end + 8) !== zip.readUInt16LE(end + 10) ||
    zip.readUInt16LE(end + 10) > MAX_ADDON_ENTRIES ||
    zip.readUInt32LE(end + 16) + zip.readUInt32LE(end + 12) !== end
  )
    throw new Error(
      'use a single-volume zip with at most 1,000 entries (without zip64).',
    )
  // unzipper 0.12 supports tailSize; its separately maintained types omit it.
  const open = Open.buffer as (
    data: Buffer,
    options: { tailSize: number },
  ) => Promise<CentralDirectory>
  const directory = await open(zip, { tailSize: zip.length - end })
  const manifests = directory.files.filter((file) =>
    /^(?:[^/]+\/)?hibi-addon\.json$/.test(file.path),
  )
  if (manifests.length !== 1)
    throw new Error(
      'zip needs one hibi-addon.json at its root or inside one package folder.',
    )
  const prefix = manifests[0]!.path.slice(0, -'hibi-addon.json'.length)
  let total = 0
  const seen = new Set<string>()
  for (const file of directory.files) {
    const path = file.path.replace(/\/$/, '')
    const mode = (file.externalFileAttributes >>> 16) & 0xf000
    if (
      file.flags & 1 ||
      ![0, 0x8000, 0x4000].includes(mode) ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').includes('..')
    )
      throw new Error(
        'addon zips cannot contain symlinks, special files, encrypted files, or unsafe paths.',
      )
    if (
      path.startsWith('__MACOSX/') ||
      path === '__MACOSX' ||
      path.split('/').some((part) => part.startsWith('.'))
    )
      continue
    if (!validAddonPath(path)) throw new Error('invalid path in addon zip.')
    if (prefix && file.path === prefix && file.type === 'Directory') continue
    if (!file.path.startsWith(prefix))
      throw new Error('zip must contain a single addon package folder.')
    const relative = path.slice(prefix.length)
    if (!validAddonPath(relative) || seen.has(relative.toLowerCase()))
      throw new Error('invalid or duplicate path in addon zip.')
    seen.add(relative.toLowerCase())
    if (file.type === 'Directory') {
      await mkdir(join(destination, relative), { recursive: true, mode: 0o700 })
      continue
    }
    if (file.uncompressedSize > MAX_ADDON_FILE_BYTES)
      throw new Error('addon files must stay under 5 mib.')
    const parts: Buffer[] = []
    let size = 0
    const stream = file.stream()
    try {
      for await (const chunk of stream) {
        const part = Buffer.from(chunk)
        size += part.length
        total += part.length
        if (size > MAX_ADDON_FILE_BYTES || total > MAX_ADDON_BYTES)
          throw new Error('addon package exceeds file limits.')
        parts.push(part)
      }
    } finally {
      stream.destroy()
    }
    const content = Buffer.concat(parts)
    if (size !== file.uncompressedSize || crc32(content) !== file.crc32)
      throw new Error('addon zip contains a damaged file.')
    const target = join(destination, relative)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, content, { flag: 'wx', mode: 0o600 })
  }
  return destination
}
