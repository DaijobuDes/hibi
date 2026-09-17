import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'asciidoc',
  name: 'AsciiDoc',
  apiVersion: 1,
  kind: 'extension',
  description: 'AsciiDoc source editing, preview, and export.',
  fileExtensions: fileAssociations.asciidoc.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
