import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import {
  actions,
  defaultHotkeys,
  type Hotkeys,
  validateHotkeys,
} from '../shared/hotkeys'

export let hotkeys = defaultHotkeys(process.platform)
let saving = false

export async function loadHotkeys(): Promise<void> {
  try {
    const stored = JSON.parse(
      await readFile(join(app.getPath('userData'), 'hotkeys.json'), 'utf8'),
    ) as Record<string, unknown>
    const next = defaultHotkeys(process.platform)
    for (const { id } of actions) {
      if (typeof stored[id] === 'string') next[id] = stored[id]
      else if (Object.values(stored).includes(next[id])) next[id] = ''
    }
    hotkeys = validateHotkeys(next, process.platform)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('could not load hotkeys:', error)
  }
}

export async function saveHotkeys(value: unknown): Promise<Hotkeys> {
  const next = validateHotkeys(value, process.platform)
  if (saving) throw new Error('hotkeys are still saving. try again.')
  saving = true
  try {
    const path = join(app.getPath('userData'), 'hotkeys.json')
    await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
    hotkeys = next
    return hotkeys
  } finally {
    saving = false
  }
}
