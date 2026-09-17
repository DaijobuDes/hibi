import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'org',
  name: 'Org mode',
  apiVersion: 1,
  kind: 'extension',
  description: 'Org mode source editing, preview, and export.',
  fileExtensions: fileAssociations.org.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
