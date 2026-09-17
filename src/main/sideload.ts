import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { extname, join } from 'node:path'
import { app, type BrowserWindow, dialog, shell } from 'electron'
import { ADDON_API_VERSION, type AddonManifest } from '../addons/api'
import {
  type ColorschemeInput,
  defineColorscheme,
} from '../shared/colorschemes'
import type { InstalledAddon } from '../shared/sideload'

type Package = InstalledAddon & { entry: string; hash: string; files: string[] }
let installed: Package[] = []
const root = () => join(app.getPath('userData'), 'installed-addons')
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)
function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length < 2048 &&
    value
      .split('/')
      .every(
        (part) =>
          !!part &&
          !part.startsWith('.') &&
          !/[\\:?%#<>"|*]|\p{Cc}/u.test(part),
      )
  )
}

import { validDocumentExtensions } from '../shared/document-types'

function manifest(value: unknown): {
  manifest: AddonManifest
  entry: string
  themes: ColorschemeInput[]
} {
  if (!value || typeof value !== 'object')
    throw new Error('invalid addon manifest.')
  const data = value as Record<string, unknown>
  const string = (value: unknown, max: number): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= max
  if (
    !validId(data.id) ||
    !string(data.name, 100) ||
    !string(data.description, 500) ||
    data.apiVersion !== ADDON_API_VERSION ||
    !['theme', 'extension'].includes(String(data.kind)) ||
    !string(data.version, 40) ||
    !Array.isArray(data.authors) ||
    !data.authors.length ||
    data.authors.length > 20 ||
    data.authors.some(
      (author) =>
        !author ||
        !string(author.displayName, 100) ||
        (author.discordId !== undefined &&
          (typeof author.discordId !== 'string' ||
            !/^\d{5,24}$/.test(author.discordId))) ||
        (author.github !== undefined &&
          (typeof author.github !== 'string' ||
            !/^[a-z\d-]{1,39}$/i.test(author.github))) ||
        (author.role !== undefined && !string(author.role, 100)),
    )
  )
    throw new Error(
      'addon needs an id, kind, api version, version, description, and authors.',
    )
  if (
    data.licenses !== undefined &&
    (!Array.isArray(data.licenses) ||
      data.licenses.length > 50 ||
      data.licenses.some(
        (license) =>
          !license ||
          !validId(license.id) ||
          !string(license.name, 100) ||
          !string(license.license, 100) ||
          !string(license.text, 32000),
      ))
  )
    throw new Error('invalid addon licenses.')
  if (
    data.fileExtensions !== undefined &&
    (data.kind === 'theme' || !validDocumentExtensions(data.fileExtensions))
  )
    throw new Error('invalid document extensions.')
  const base: AddonManifest = {
    id: data.id,
    name: data.name,
    description: data.description,
    apiVersion: ADDON_API_VERSION,
    kind: data.kind as 'theme' | 'extension',
    version: data.version,
    authors: data.authors,
    defaultEnabled: false,
    ...(data.fileExtensions !== undefined
      ? {
          fileExtensions: data.fileExtensions,
        }
      : {}),
    ...(data.licenses
      ? { licenses: data.licenses as NonNullable<AddonManifest['licenses']> }
      : {}),
  }
  if (base.kind === 'theme') {
    if (
      data.entry !== undefined ||
      !Array.isArray(data.themes) ||
      !data.themes.length ||
      data.themes.length > 20
    )
      throw new Error(
        'theme packages contain colorschemes, not executable entries.',
      )
    const themes = data.themes.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !value.colors ||
        typeof value.colors !== 'object'
      )
        throw new Error('invalid colorscheme.')
      return defineColorscheme(value as ColorschemeInput)
    })
    if (
      themes.some((theme) => !validId(theme.id)) ||
      new Set(themes.map((theme) => theme.id)).size !== themes.length
    )
      throw new Error('invalid or duplicate theme id.')
    base.licenses = [
      ...(base.licenses ?? []),
      ...themes.map((theme) => ({
        id: `theme-${theme.id}`,
        name: theme.name,
        license: theme.license.name,
        text: theme.license.text,
      })),
    ]
    return { manifest: base, entry: '', themes }
  }
  if (!validPath(data.entry) || !/\.(m?js)$/.test(data.entry))
    throw new Error('extension entry must be a relative .js or .mjs module.')
  return { manifest: base, entry: data.entry, themes: [] }
}
async function readManifest(folder: string) {
  const path = join(folder, 'hibi-addon.json')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new Error('addon manifest must be a regular json file under 64 kib.')
  return manifest(JSON.parse(await readFile(path, 'utf8')))
}
function descriptor(data: Omit<Package, 'url'>): Package {
  return {
    ...data,
    url: data.entry
      ? `app://hibi/installed-addons/${data.manifest.id}/${data.hash}/${data.entry}`
      : null,
  }
}
export function installedAddons(): InstalledAddon[] {
  return installed.map(({ manifest, url, themes }) => ({
    manifest,
    url,
    themes,
  }))
}
export async function loadInstalledAddons(builtinIds: readonly string[]) {
  const entries = await readdir(root(), { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return []
    },
  )
  const next: Package[] = []
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !validId(entry.name) ||
      builtinIds.includes(entry.name)
    )
      continue
    try {
      const folder = join(root(), entry.name)
      const data = await readManifest(folder)
      const record = JSON.parse(
        await readFile(join(folder, '.hibi-install.json'), 'utf8'),
      )
      if (
        data.manifest.id !== entry.name ||
        !/^[a-f\d]{64}$/.test(record.hash) ||
        !Array.isArray(record.files) ||
        record.files.length > 1000 ||
        !record.files.every(validPath)
      )
        throw new Error('invalid installation record.')
      next.push(descriptor({ ...data, hash: record.hash, files: record.files }))
    } catch (error) {
      console.error(`could not load installed addon ${entry.name}:`, error)
    }
  }
  installed = next
}
export async function installPackage(
  window: BrowserWindow,
  builtinIds: readonly string[],
  disable: (id: string) => Promise<() => Promise<void>>,
): Promise<boolean> {
  const selection = await dialog.showOpenDialog(window, {
    title: 'install addon package folder',
    properties: ['openDirectory'],
  })
  if (selection.canceled || !selection.filePaths[0]) return false
  const source = await realpath(selection.filePaths[0])
  const data = await readManifest(source)
  if (builtinIds.includes(data.manifest.id))
    throw new Error('an installed package cannot replace a bundled addon.')
  const verdict = await dialog.showMessageBox(window, {
    type: data.manifest.kind === 'extension' ? 'warning' : 'question',
    message: `install ${data.manifest.name} ${data.manifest.version}?`,
    detail: `${data.manifest.description}\n\nby ${data.manifest.authors?.map((author) => author.displayName).join(', ')}\n\n${data.manifest.kind === 'extension' ? 'extensions run trusted renderer code and can read and edit documents through hibi’s api. only install code you trust. ' : ''}the addon will be installed disabled.`,
    buttons: [
      'cancel',
      installed.some((item) => item.manifest.id === data.manifest.id)
        ? 'replace package'
        : 'install',
    ],
    defaultId: 0,
    cancelId: 0,
  })
  if (verdict.response !== 1) return false
  await mkdir(root(), { recursive: true, mode: 0o700 })
  const staging = join(root(), `.staging-${randomUUID()}`)
  await mkdir(staging, { mode: 0o700 })
  const files: string[] = []
  let bytes = 0
  let count = 0
  const hash = createHash('sha256')
  let restore: (() => Promise<void>) | undefined
  const destination = join(root(), data.manifest.id),
    backup = join(root(), `.backup-${randomUUID()}`)
  let backedUp = false,
    replaced = false
  try {
    async function copy(directory: string, parent = '') {
      const entries = (await readdir(directory, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (++count > 1000)
          throw new Error('addon packages support up to 1,000 entries.')
        const relative = parent ? `${parent}/${entry.name}` : entry.name
        if (!validPath(relative) || entry.isSymbolicLink())
          throw new Error(
            'addon packages cannot contain symlinks or invalid paths.',
          )
        const path = join(directory, entry.name),
          target = join(staging, relative)
        if (entry.isDirectory()) {
          await mkdir(target)
          await copy(path, relative)
          continue
        }
        if (
          !entry.isFile() ||
          ![
            '.js',
            '.mjs',
            '.json',
            '.css',
            '.woff',
            '.woff2',
            '.ttf',
            '.svg',
            '.png',
            '.jpg',
            '.jpeg',
            '.webp',
            '.gif',
            '.mp3',
            '.ogg',
            '.wav',
            '.md',
            '.txt',
          ].includes(extname(entry.name).toLowerCase())
        )
          throw new Error(`unsupported package file: ${relative}`)
        const stat = await lstat(path)
        if (
          stat.isSymbolicLink() ||
          stat.size > 5 * 1024 * 1024 ||
          files.length >= 1000
        )
          throw new Error('addon package exceeds file limits.')
        const content = await readFile(path)
        bytes += content.length
        if (bytes > 25 * 1024 * 1024)
          throw new Error('addon package must stay under 25 mib.')
        await writeFile(target, content, { mode: 0o600, flag: 'wx' })
        files.push(relative)
        hash.update(relative).update('\0').update(content)
      }
    }
    await copy(source)
    if (
      !files.includes('README.md') ||
      (data.entry && !files.includes(data.entry))
    )
      throw new Error('package needs README.md and its declared entry.')
    const copied = await readManifest(staging)
    if (JSON.stringify(copied) !== JSON.stringify(data))
      throw new Error('package changed while installing. try again.')
    const fingerprint = hash.digest('hex')
    await writeFile(
      join(staging, '.hibi-install.json'),
      JSON.stringify({ hash: fingerprint, files }),
      { mode: 0o600 },
    )
    const exists = await lstat(destination).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return null
      },
    )
    if (
      exists &&
      !installed.some((item) => item.manifest.id === data.manifest.id)
    )
      throw new Error('an unrecognized package already uses that id.')
    restore = await disable(data.manifest.id)
    if (exists) {
      await rename(destination, backup)
      backedUp = true
    }
    await rename(staging, destination)
    replaced = true
    installed = [
      ...installed.filter((item) => item.manifest.id !== data.manifest.id),
      descriptor({ ...copied, hash: fingerprint, files }),
    ]
    if (backedUp)
      await shell
        .trashItem(backup)
        .catch((error) => console.error('old addon package retained:', error))
    return true
  } catch (error) {
    if (!replaced && backedUp) await rename(backup, destination)
    if (!replaced) await restore?.()
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
export async function removePackage(id: unknown): Promise<void> {
  const packageInfo = installed.find((item) => item.manifest.id === id)
  if (!packageInfo) throw new Error('only sideloaded addons can be removed.')
  await shell.trashItem(join(root(), packageInfo.manifest.id))
  installed = installed.filter((item) => item !== packageInfo)
}
export async function installedAsset(url: string): Promise<string | null> {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'app:' ||
    parsed.host !== 'hibi' ||
    parsed.username ||
    parsed.password
  )
    return null
  const [, prefix, id, hash, ...parts] = decodeURIComponent(
    parsed.pathname,
  ).split('/')
  if (prefix !== 'installed-addons') return null
  const entry = installed.find(
    (item) => item.manifest.id === id && item.hash === hash,
  )
  const relative = parts.join('/')
  if (!entry || !validPath(relative) || !entry.files.includes(relative))
    return null
  let path = join(root(), entry.manifest.id)
  if ((await lstat(path)).isSymbolicLink()) return null
  for (const part of parts) {
    path = join(path, part)
    if ((await lstat(path)).isSymbolicLink()) return null
  }
  const stat = await lstat(path)
  return stat.isFile() && stat.size <= 5 * 1024 * 1024 ? path : null
}
