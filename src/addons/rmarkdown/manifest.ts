import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'rmarkdown',
  name: 'R Markdown',
  apiVersion: 1,
  kind: 'extension',
  description:
    'R Markdown source editing, preview, and export with an explicit native run action.',
  fileExtensions: fileAssociations.rmarkdown.ext,
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
