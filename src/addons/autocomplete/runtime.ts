export type AutocompleteControls = {
  workspaceId: string | null
  workspaceName: string
  documentId: string | null
  documentName: string
  available: boolean
  clear: (all: boolean) => Promise<void>
}

let current: AutocompleteControls | null = null
const listeners = new Set<() => void>()

export const getControls = () => current
export function setControls(value: AutocompleteControls | null) {
  current = value
  for (const listener of listeners) listener()
}
export function onControlsChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
