import { AsyncLocalStorage } from 'node:async_hooks'

type Operation = {
  dialogs: number
  opened?: Promise<void>
  notify?: () => void
}
const operations = new AsyncLocalStorage<Operation>()
let active: Operation | null = null

export const fileOperationHasDialog = () => (active?.dialogs ?? 0) > 0
export function fileOperationDialogOpened() {
  if (!active) return
  const current = active
  current.opened ??= new Promise<void>((resolve) => {
    current.notify = resolve
  })
  return current.opened
}

export async function withinFileOperation<T>(operation: () => Promise<T>) {
  const current: Operation = { dialogs: 0 }
  active = current
  try {
    return await operations.run(current, operation)
  } finally {
    active = null
  }
}

export async function runFileDialog<T>(open: () => Promise<T>) {
  const current = operations.getStore()
  if (current) {
    current.dialogs++
    current.notify?.()
  }
  try {
    return await open()
  } finally {
    if (current && --current.dialogs === 0) {
      delete current.opened
      delete current.notify
    }
  }
}
