import { flushSync } from 'react-dom'

let current: ViewTransition | undefined

export function animateChange(update: () => void): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    flushSync(update)
    return Promise.resolve()
  }
  current?.skipTransition()
  current = window.document.startViewTransition(() => flushSync(update))
  return current.updateCallbackDone
}
