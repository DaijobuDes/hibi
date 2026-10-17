import { setTimeout as delay } from 'node:timers/promises'

/** Retry brief Windows sharing violations without changing the rename operation. */
export async function retryRename<T>(
  rename: () => Promise<T>,
  beforeRetry?: () => void | Promise<void>,
): Promise<T> {
  let originalError: unknown
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename()
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(
          (error as NodeJS.ErrnoException)?.code ?? '',
        )
      )
        throw error
      if (attempt === 0) originalError = error
      if (attempt === 4) throw originalError
      await delay(20 * (attempt + 1))
      if (beforeRetry) await beforeRetry()
    }
  }
}
