import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'creole',
  name: 'Creole',
  apiVersion: 1,
  kind: 'extension',
  description: 'Creole source editing, preview, and export.',
  fileExtensions: fileAssociations.creole.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
