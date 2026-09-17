import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'djot',
  name: 'Djot',
  apiVersion: 1,
  kind: 'extension',
  description: 'Djot source editing, preview, and export.',
  fileExtensions: fileAssociations.djot.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
