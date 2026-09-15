import type { AddonManifest } from '../api'

export default {
  id: 'frontmatter',
  name: 'frontmatter',
  description:
    'edit YAML properties while preserving metadata and the document body.',
  apiVersion: 1,
  defaultEnabled: true,
} satisfies AddonManifest
