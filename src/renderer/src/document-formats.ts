import { StreamLanguage } from '@codemirror/language'
import { createElement } from 'react'
import type { DocumentFormat } from '../../addons/api'
import type { DocumentState } from '../../shared/desktop'
import {
  type DocumentView,
  documentExtension,
  documentViews,
  isDocumentView,
} from '../../shared/document-types'

const plainText: DocumentFormat = {
  id: 'core.text',
  name: 'Plain text',
  extensions: ['txt'],
  views: ['markdown'],
  language: StreamLanguage.define({
    token(stream) {
      stream.skipToEnd()
      return null
    },
  }),
  Preview: ({ value }) =>
    createElement('pre', { className: 'plain-text-preview' }, value),
  render: async (source) => ({
    html: `<pre>${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`,
    css: '',
  }),
}
const registry = new Map<string, DocumentFormat>([[plainText.id, plainText]])
const listeners = new Set<() => void>()
const sourceViews: readonly DocumentView[] = ['markdown']
const previewViews: readonly DocumentView[] = ['side-by-side', 'markdown']
let snapshot: readonly DocumentFormat[] = [plainText]
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
  isMarkdown(name: string) {
    return documentFormats.get(name)?.editing === 'markdown'
  },
  views(name: string): readonly DocumentView[] {
    const format = documentFormats.get(name)
    return (
      format?.views ??
      (format?.editing === 'markdown'
        ? documentViews
        : format
          ? previewViews
          : sourceViews)
    )
  },
  register(owner: string, format: DocumentFormat, declared: readonly string[]) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(format.id) ||
      !format.extensions.length ||
      format.extensions.some((extension) => !declared.includes(extension)) ||
      (format.views !== undefined &&
        (!Array.isArray(format.views) ||
          !format.views.includes('markdown') ||
          format.views.some((view) => !isDocumentView(view))))
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
