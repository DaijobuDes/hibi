import type {
  ToolbarApi,
  ToolbarItem,
  ToolbarPreferences,
} from '../../ui/toolbar'

const key = 'hibi:toolbar'
let preferences: ToolbarPreferences = { visible: true, mode: 'icons' }
try {
  const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
  if (typeof saved?.visible === 'boolean') preferences.visible = saved.visible
  if (['icons', 'icons-and-text', 'text'].includes(saved?.mode))
    preferences.mode = saved.mode
} catch {
  /* Keep defaults when stored preferences cannot be read. */
}
const items = new Map<string, ToolbarItem>()
let snapshot = { preferences, items: [] as ToolbarItem[] }
const listeners = new Set<() => void>()
const publish = () => {
  snapshot = { preferences, items: [...items.values()] }
  for (const listener of listeners) listener()
}
function setPreferences(changes: Partial<ToolbarPreferences>) {
  preferences = {
    visible:
      typeof changes.visible === 'boolean'
        ? changes.visible
        : preferences.visible,
    mode:
      changes.mode && ['icons', 'icons-and-text', 'text'].includes(changes.mode)
        ? changes.mode
        : preferences.mode,
  }
  localStorage.setItem(key, JSON.stringify(preferences))
  publish()
}

export const toolbar = {
  snapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  setPreferences,
  scope(owner: string, onError: (error: unknown) => void) {
    let disposed = false
    const owned = new Set<() => void>()
    const api: ToolbarApi = {
      getPreferences: () => ({ ...preferences }),
      setPreferences(changes) {
        if (!disposed) setPreferences(changes)
      },
      register(initial) {
        if (disposed) return { update() {}, dispose() {} }
        const id = `${owner}.${initial.id}`
        if (!/^[a-z][a-z0-9-]*$/.test(initial.id) || items.has(id))
          throw new Error(`duplicate or invalid toolbar item: ${id}`)
        let active = true
        let item = initial
        const render = () => {
          items.set(id, {
            ...item,
            id,
            async onClick() {
              if (!active || disposed || item.disabled) return
              try {
                await item.onClick()
              } catch (error) {
                onError(error)
              }
            },
          })
          publish()
        }
        const dispose = () => {
          if (!active) return
          active = false
          items.delete(id)
          owned.delete(dispose)
          publish()
        }
        owned.add(dispose)
        render()
        return {
          dispose,
          update(changes) {
            if (!active || disposed) return
            item = { ...item, ...changes }
            render()
          },
        }
      },
    }
    return {
      api,
      dispose() {
        disposed = true
        for (const remove of owned) remove()
      },
    }
  },
}
