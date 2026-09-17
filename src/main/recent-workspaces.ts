import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app } from 'electron'
import type { RecentWorkspace } from '../shared/workspace'

let writing: Promise<void> = Promise.resolve()
const location = () => join(app.getPath('userData'), 'recent-workspaces.json')

export async function getRecentWorkspaces(): Promise<RecentWorkspace[]> {
  try {
    const saved: unknown = JSON.parse(await readFile(location(), 'utf8'))
    if (!Array.isArray(saved)) return []
    return [...new Set(saved)]
      .filter(
        (path): path is string =>
          typeof path === 'string' &&
          path.length <= 4096 &&
          !path.includes('\0') &&
          isAbsolute(path),
      )
      .slice(0, 5)
      .map((path) => ({
        id: createHash('sha256').update(path).digest('hex'),
        path,
      }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('could not read recent workspaces:', error)
    return []
  }
}

export function rememberWorkspace(path: string): Promise<void> {
  writing = writing
    .catch(() => {})
    .then(async () => {
      const recent = await getRecentWorkspaces()
      const paths = [
        path,
        ...recent.map((item) => item.path).filter((item) => item !== path),
      ].slice(0, 5)
      const file = location()
      await writeFile(`${file}.tmp`, JSON.stringify(paths), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    })
  return writing
}
