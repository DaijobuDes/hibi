import type { DocumentFormat } from '../../addons/api'
import type { DocumentState } from '../../shared/desktop'
import { documentExtension } from '../../shared/document-types'

const registry = new Map<string, DocumentFormat>()
const listeners = new Set<() => void>()
let snapshot: readonly DocumentFormat[] = []
export const documentFormats = {
  snapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get(name: string) {
    return snapshot.find((format) =>
      format.extensions.includes(documentExtension(name)),
    )
  },
  register(owner: string, format: DocumentFormat, declared: readonly string[]) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(format.id) ||
      !format.extensions.length ||
      format.extensions.some((extension) => !declared.includes(extension))
    )
      throw new Error(
        'declare document extensions in the addon manifest before registering a format.',
      )
    if (
      snapshot.some((entry) =>
        entry.extensions.some((extension) =>
          format.extensions.includes(extension),
        ),
      )
    )
      throw new Error('a document format already handles this extension.')
    const key = `${owner}.${format.id}`
    const entry = { ...format, id: key }
    const publish = () => {
      snapshot = [...registry.values()]
      for (const listener of listeners) listener()
    }
    registry.set(key, entry)
    publish()
    return () => {
      if (registry.get(key) === entry) {
        registry.delete(key)
        publish()
      }
    }
  },
}

let active: DocumentState | null = null
const observers = new Set<(document: Readonly<DocumentState>) => void>()
export const editorDocument = {
  get: () => active,
  publish(document: DocumentState | null) {
    active = document ? Object.freeze({ ...document }) : null
    if (active) for (const observer of observers) observer(active)
  },
  subscribe(observer: (document: Readonly<DocumentState>) => void) {
    observers.add(observer)
    if (active) observer(active)
    return () => {
      observers.delete(observer)
    }
  },
}
