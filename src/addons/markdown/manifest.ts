import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'markdown',
  name: 'Markdown',
  apiVersion: 1,
  kind: 'extension',
  description:
    'Markdown documents with rich editing, source view, and HTML export.',
  defaultEnabled: true,
  fileExtensions: fileAssociations.markdown.ext,
  authors: [authors.may],
} satisfies AddonManifest
