import { lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { TableLayout } from '../shared/table-layout'
import {
  readWorkspaceLayoutText,
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_LIMIT,
  writeWorkspaceText,
} from './workspace-metadata'

type Layout = {
  version: 1
  documents: Record<string, { tables: TableLayout[] }>
}

const sizes = (value: unknown) =>
  value === null ||
  (Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((size) => Number.isInteger(size) && size >= 0 && size <= 10000))

export function validateTableLayout(input: unknown): TableLayout[] {
  if (
    !Array.isArray(input) ||
    input.length > 1000 ||
    !input.every(
      (table) =>
        table &&
        typeof table === 'object' &&
        typeof table.key === 'string' &&
        table.key.length <= 64 &&
        sizes(table.columns) &&
        sizes(table.rows),
    )
  )
    throw new Error('The table layout is invalid.')
  return input.map(({ key, columns, rows }) => ({ key, columns, rows }))
}

const documentPath = (path: string) =>
  !!path &&
  path.length <= 4096 &&
  !path.includes('\\') &&
  !isAbsolute(path) &&
  !path.split('/').some((part) => !part || part === '.' || part === '..')

async function readLayout(root: string): Promise<Layout> {
  const source = await readWorkspaceLayoutText(root)
  // Null prototype, so a document named __proto__ is an ordinary entry.
  const layout: Layout = { version: 1, documents: Object.create(null) }
  if (!source) return layout
  let parsed: { version?: unknown; documents?: unknown }
  try {
    parsed = JSON.parse(source)
  } catch {
    return layout
  }
  if (parsed?.version !== 1)
    throw new Error(
      `${WORKSPACE_LAYOUT} was written by a newer version of Hibi. Update Hibi to keep table sizes.`,
    )
  if (!parsed.documents || typeof parsed.documents !== 'object') return layout
  for (const [path, entry] of Object.entries(parsed.documents)) {
    try {
      if (documentPath(path))
        layout.documents[path] = {
          tables: validateTableLayout((entry as { tables?: unknown }).tables),
        }
    } catch {
      // One damaged entry must not discard the sizes of other documents.
    }
  }
  return layout
}

let queue: Promise<unknown> = Promise.resolve()
// Read-modify-write updates share one file, so they run one at a time.
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

async function update(
  root: string,
  change: (layout: Layout) => boolean | Promise<boolean>,
  keep?: string,
) {
  return serial(async () => {
    const layout = await readLayout(root)
    if (!(await change(layout))) return
    let text = `${JSON.stringify(layout, null, 2)}\n`
    // Keep the file readable: drop the least recently written documents first.
    for (const path of Object.keys(layout.documents)) {
      if (Buffer.byteLength(text) <= WORKSPACE_LAYOUT_LIMIT) break
      if (path === keep) continue
      delete layout.documents[path]
      text = `${JSON.stringify(layout, null, 2)}\n`
    }
    if (Buffer.byteLength(text) > WORKSPACE_LAYOUT_LIMIT)
      throw new Error('These table sizes are too large to save.')
    await writeWorkspaceText(root, WORKSPACE_LAYOUT, text)
  })
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) =>
      !['ENOENT', 'ENOTDIR'].includes(error.code ?? ''),
  )

/** Workspace-relative POSIX path in, stored tables out. */
export async function readTableLayout(
  root: string,
  path: string,
): Promise<TableLayout[]> {
  if (!documentPath(path)) throw new Error('Choose a file in this workspace.')
  return (await readLayout(root)).documents[path]?.tables ?? []
}

/** Replace one document's tables and prune entries whose files are gone. */
export async function writeTableLayout(
  root: string,
  path: string,
  input: unknown,
): Promise<void> {
  if (!documentPath(path)) throw new Error('Choose a file in this workspace.')
  const tables = validateTableLayout(input).filter(
    (table) => table.columns?.some(Boolean) || table.rows?.some(Boolean),
  )
  await update(root, async (layout) => {
    let changed = false
    for (const entry of Object.keys(layout.documents))
      if (entry !== path && !(await exists(join(root, entry)))) {
        delete layout.documents[entry]
        changed = true
      }
    if (
      JSON.stringify(layout.documents[path]?.tables ?? []) ===
      JSON.stringify(tables)
    )
      return changed
    // Re-inserting moves the document last, so key order is write recency.
    delete layout.documents[path]
    if (tables.length) layout.documents[path] = { tables }
    return true
  }, path)
}

/** Follow a file or folder rename inside the workspace. */
export async function moveTableLayout(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  if (!documentPath(from) || !documentPath(to)) return
  await update(root, (layout) => {
    let changed = false
    for (const [path, entry] of Object.entries(layout.documents)) {
      const target =
        path === from
          ? to
          : path.startsWith(`${from}/`)
            ? to + path.slice(from.length)
            : null
      if (!target) continue
      delete layout.documents[path]
      layout.documents[target] = entry
      changed = true
    }
    return changed
  })
}
