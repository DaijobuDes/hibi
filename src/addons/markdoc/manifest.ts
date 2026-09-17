import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'markdoc',
  name: 'Markdoc',
  apiVersion: 1,
  kind: 'extension',
  description: 'Markdoc source editing, preview, and export.',
  fileExtensions: fileAssociations.markdoc.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
