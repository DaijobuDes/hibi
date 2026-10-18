import { AsyncLocalStorage } from 'node:async_hooks'

const operations = new AsyncLocalStorage<{ dialogs: number }>()
let active: { dialogs: number } | null = null

export const fileOperationHasDialog = () => (active?.dialogs ?? 0) > 0

export async function withinFileOperation<T>(operation: () => Promise<T>) {
  const current = { dialogs: 0 }
  active = current
  try {
    return await operations.run(current, operation)
  } finally {
    active = null
  }
}

export async function runFileDialog<T>(open: () => Promise<T>) {
  const current = operations.getStore()
  if (current) current.dialogs++
  try {
    return await open()
  } finally {
    if (current) current.dialogs--
  }
}
