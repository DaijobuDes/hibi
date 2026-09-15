import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'documentation',
  name: 'documentation',
  version: '0.1.0',
  authors: [authors.may],
  description:
    'publish a markdown workspace as a searchable, self-contained static site.',
  apiVersion: 1,
  defaultEnabled: true,
} satisfies AddonManifest
