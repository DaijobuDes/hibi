import type { AddonManifest } from '../api'

export default {
  id: 'documentation',
  name: 'documentation',
  description:
    'publish a markdown workspace as a searchable, self-contained static site.',
  apiVersion: 1,
  defaultEnabled: true,
} satisfies AddonManifest
