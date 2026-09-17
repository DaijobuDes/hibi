import { documentExtension, markdownExtensions } from '../shared/document-types'

let extra: readonly string[] = []
export function setDocumentExtensions(extensions: readonly string[]) {
  extra = [...new Set(extensions)]
}
export function documentExtensions() {
  return [...markdownExtensions, ...extra]
}
export function isDocumentName(name: string, workspace = false) {
  const extension = documentExtension(name)
  return (
    workspace ? ['md', 'markdown', ...extra] : documentExtensions()
  ).includes(extension)
}
