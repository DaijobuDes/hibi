import type { UiCase } from '../shared/ui-case'
import './ui-case.css'

let value: UiCase = 'sentence'
try {
  if (localStorage.getItem('hibi:ui-case') === 'lowercase') value = 'lowercase'
} catch {
  /* Default to sentence case. */
}
const listeners = new Set<() => void>()
function apply() {
  document.documentElement.dataset.uiCase = value
  void window.hibi
    ?.setUiCase?.(value)
    .catch((error: unknown) =>
      console.error('Could not update menu casing:', error),
    )
}
apply()
export const uiCase = {
  snapshot: () => value,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  set(next: UiCase) {
    value = next
    localStorage.setItem('hibi:ui-case', value)
    apply()
    for (const listener of listeners) listener()
  },
}
