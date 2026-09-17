import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'html',
  name: 'HTML',
  apiVersion: 1,
  kind: 'extension',
  description: 'HTML source editing, preview, and export.',
  fileExtensions: fileAssociations.html.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
