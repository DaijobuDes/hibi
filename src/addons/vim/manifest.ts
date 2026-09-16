import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'vim',
  name: 'vim',
  version: '0.2.0',
  authors: [authors.may],
  description: 'vim editing in markdown and split source panes.',
  apiVersion: 1,
  defaultEnabled: false,
} satisfies AddonManifest
