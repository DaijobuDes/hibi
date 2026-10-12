import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import {
  addonPackageUrl,
  MAX_ADDON_BYTES,
  MAX_ADDON_ENTRIES,
  MAX_ADDON_FILE_BYTES,
  validAddonPath,
} from '../shared/addon-package.ts'
import { download } from './download.ts'
import { openBoundedZip } from './zip-reader.ts'
/** No cookies, credentials, or code execution; redirects must remain HTTPS. */
export async function downloadAddon(
  value: unknown,
): Promise<{ zip: Buffer; host: string }> {
  const parts: Uint8Array[] = []
  const result = await download(addonPackageUrl(value).href, {
    maxBytes: MAX_ADDON_BYTES,
    parseUrl: addonPackageUrl,
    signal: AbortSignal.timeout(20000),
    accept: 'application/zip',
    write: (chunk) => {
      parts.push(chunk)
    },
  })
  return { zip: Buffer.concat(parts), host: new URL(result.url).host }
}

/** Extract only bounded regular files into an owned, empty staging directory. */
export async function unpackAddon(
  zip: Buffer,
  destination: string,
): Promise<string> {
  if (zip.length > MAX_ADDON_BYTES || zip.length < 22)
    throw new Error('This is not a valid addon ZIP file.')
  const directory = await openBoundedZip(zip, MAX_ADDON_ENTRIES)
  const manifests = directory.files.filter((file) =>
    /^(?:[^/]+\/)?hibi-addon\.json$/.test(file.path),
  )
  if (manifests.length !== 1)
    throw new Error(
      'The ZIP file needs one hibi-addon.json at its root or inside a single addon folder.',
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
        'Addon ZIP files cannot contain symbolic links, special files, encrypted files, or unsafe paths.',
      )
    if (
      path.startsWith('__MACOSX/') ||
      path === '__MACOSX' ||
      path.split('/').some((part) => part.startsWith('.'))
    )
      continue
    if (!validAddonPath(path))
      throw new Error('The addon ZIP file contains an invalid path.')
    if (prefix && file.path === prefix && file.type === 'Directory') continue
    if (!file.path.startsWith(prefix))
      throw new Error('The ZIP file must contain a single addon folder.')
    const relative = path.slice(prefix.length)
    if (!validAddonPath(relative) || seen.has(relative.toLowerCase()))
      throw new Error(
        'The addon ZIP file contains an invalid or duplicate path.',
      )
    seen.add(relative.toLowerCase())
    if (file.type === 'Directory') {
      await mkdir(join(destination, relative), { recursive: true, mode: 0o700 })
      continue
    }
    if (file.uncompressedSize > MAX_ADDON_FILE_BYTES)
      throw new Error('Each addon file must be no larger than 5 MiB.')
    const parts: Buffer[] = []
    let size = 0
    const stream = file.stream()
    try {
      for await (const chunk of stream) {
        const part = Buffer.from(chunk)
        size += part.length
        total += part.length
        if (size > MAX_ADDON_FILE_BYTES || total > MAX_ADDON_BYTES)
          throw new Error(
            'The addon exceeds the limit of 5 MiB per file or 25 MiB in total.',
          )
        parts.push(part)
      }
    } finally {
      stream.destroy()
    }
    const content = Buffer.concat(parts)
    if (size !== file.uncompressedSize || crc32(content) !== file.crc32)
      throw new Error('The addon ZIP file is damaged. Download it again.')
    const target = join(destination, relative)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, content, { flag: 'wx', mode: 0o600 })
  }
  return destination
}
