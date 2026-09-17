import { fileAssociations } from '../../shared/file-associations'
import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'math',
  name: 'LaTeX',
  kind: 'extension',
  version: '1.0.0',
  apiVersion: 1,
  description:
    'LaTeX documents, native PDF compilation, and inline and block math with KaTeX.',
  defaultEnabled: false,
  fileExtensions: fileAssociations.math.ext,
  authors: [authors.may],
} satisfies AddonManifest
