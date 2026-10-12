import { createHash } from 'node:crypto'
import {
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { app, dialog } from 'electron'
import { writeMarkdown } from '../../main/files'
import {
  getKnownWorkspaces,
  getRecentWorkspaces,
  rememberWorkspace,
} from '../../main/recent-workspaces'
import { testPause } from '../../main/test-pauses'
import {
  refreshWorkspace,
  scanWorkspace,
  workspaceId,
} from '../../main/workspace'
import { validateWorkspaceName } from '../../main/workspace-actions'
import { MAX_DOCUMENT_BYTES } from '../../shared/desktop'
import type { WorkspaceEntry } from '../../shared/workspace'
import type { NativeAddon, NativeAddonContext } from '../api'
import { captureWindow } from './capture'
import manifest from './manifest'

type Draft = {
  markdown: string
  /** Where this note goes, fixed when it was started. */
  destination: { id: string; path: string; folder: string } | null
}
const draftPath = () => join(app.getPath('userData'), 'quick-note-draft.json')
let draftWrites: Promise<unknown> = Promise.resolve()

function parseDraft(value: unknown): Draft | null {
  const input = value as Partial<Draft> | null
  const destination = input?.destination
  if (
    !input ||
    typeof input.markdown !== 'string' ||
    Buffer.byteLength(input.markdown) > MAX_DOCUMENT_BYTES ||
    (destination !== null &&
      (typeof destination !== 'object' ||
        typeof destination.id !== 'string' ||
        destination.id.length > 128 ||
        typeof destination.path !== 'string' ||
        destination.path.length > 4096 ||
        typeof destination.folder !== 'string' ||
        destination.folder.length > 4096))
  )
    return null
  return {
    markdown: input.markdown,
    destination: destination && {
      id: destination.id,
      path: destination.path,
      folder: destination.folder,
    },
  }
}

async function target(id: unknown, context: NativeAddonContext) {
  if (typeof id !== 'string') throw new Error('Choose a workspace.')
  const path = id
    ? ((await getKnownWorkspaces()).find((item) => item.id === id)?.path ??
      (id === workspaceId() ? context.workspace.directory() : null))
    : context.workspace.directory()
  if (!path) throw new Error('Open a workspace or choose a recent one.')
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('This workspace location changed. Choose it again.')
  const root = await realpath(path)
  if (
    root !== path ||
    (id && createHash('sha256').update(root).digest('hex') !== id)
  )
    throw new Error('This workspace location changed. Choose it again.')
  return root
}

async function folderPath(root: string, value: unknown) {
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Choose a folder inside the workspace.')
  let path = root
  if (value) {
    for (const part of value.split('/')) {
      validateWorkspaceName(part)
      path = join(path, part)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Choose an ordinary folder inside the workspace.')
    }
  }
  const resolved = await realpath(path)
  const inside = relative(root, resolved)
  if (inside === '..' || inside.startsWith(`..${sep}`))
    throw new Error('Choose a folder inside the workspace.')
  return resolved
}

function folders(entries: WorkspaceEntry[], found: string[] = []): string[] {
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue
    found.push(entry.path)
    folders(entry.children ?? [], found)
  }
  return found
}

export default {
  id: manifest.id,
  globalShortcuts: {
    capture: ({ windows }) => windows.open(captureWindow),
  },
  queries: {
    /** The unsaved note, written by `saveDraft`, so a crash does not lose it. */
    async draft() {
      try {
        return parseDraft(JSON.parse(await readFile(draftPath(), 'utf8')))
      } catch {
        return null
      }
    },
    /** Pin the destination when capture opens, so a workspace switch cannot move the note. */
    async destination(input, context) {
      const path = await target(input, context)
      return { id: createHash('sha256').update(path).digest('hex'), path }
    },
    async targets(selected) {
      const recent = await getRecentWorkspaces()
      if (
        typeof selected !== 'string' ||
        !selected ||
        recent.some((item) => item.id === selected)
      )
        return recent
      const chosen = (await getKnownWorkspaces()).find(
        (item) => item.id === selected,
      )
      return chosen ? [...recent, { id: chosen.id, path: chosen.path }] : recent
    },
    async folders(input, context) {
      const root = await target(input, context)
      return folders(await scanWorkspace(root))
    },
  },
  methods: {
    async chooseWorkspace() {
      const result = await dialog.showOpenDialog({
        title: 'Choose quick note workspace',
        properties: ['openDirectory'],
      })
      const chosen = result.filePaths[0]
      if (result.canceled || !chosen) return null
      const path = await realpath(chosen)
      if (!(await lstat(path)).isDirectory())
        throw new Error('Choose a workspace folder.')
      await rememberWorkspace(path)
      return (await getRecentWorkspaces()).find((entry) => entry.path === path)
    },
    /** Resolves once the draft is on disk; an empty note removes it. */
    async saveDraft(input) {
      const draft = parseDraft(input)
      if (!draft) throw new Error('Could not keep this note. Try again.')
      const path = draftPath()
      const write = draftWrites.then(async () => {
        if (!draft.markdown) return rm(path, { force: true })
        await writeFile(`${path}.tmp`, JSON.stringify(draft), { mode: 0o600 })
        await rename(`${path}.tmp`, path)
      })
      draftWrites = write.catch(() => {})
      await write
      return true
    },
    async save(input, context) {
      await testPause('quick-note-save')
      if (!input || typeof input !== 'object')
        throw new Error('Could not read this note. Try again.')
      const request = input as Record<string, unknown>
      const root = await target(request.workspaceId, context)
      const directory = await folderPath(root, request.folder)
      if (typeof request.title !== 'string')
        throw new Error('Enter a note title.')
      const stem = request.title.trim().replace(/\.md$/i, '')
      validateWorkspaceName(stem)
      if (typeof request.markdown !== 'string' || !request.markdown.trim())
        throw new Error('Write a note before saving.')
      for (let number = 1; number <= 10000; number++) {
        const name = `${stem}${number === 1 ? '' : ` ${number}`}.md`
        validateWorkspaceName(name)
        const path = join(directory, name)
        try {
          await writeMarkdown(path, request.markdown, true)
          if (context.workspace.directory() === root)
            await refreshWorkspace().catch((error) =>
              console.error('could not refresh quick note workspace:', error),
            )
          return { path, name: basename(path) }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      throw new Error('This folder has too many notes with that title.')
    },
  },
} satisfies NativeAddon
