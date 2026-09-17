import { documentExtension, markdownExtensions } from '../shared/document-types'

let extra: readonly string[] = []
export function setDocumentExtensions(extensions: readonly string[]) {
  extra = [...new Set(extensions)]
}
export function documentExtensions() {
  return [...new Set(['txt', ...markdownExtensions, ...extra])]
}
export function isDocumentName(name: string, _workspace = false) {
  const extension = documentExtension(name)
  return documentExtensions().includes(extension)
}
