import type { AddonManifest } from '../api'

export default {
  id: 'frontmatter',
  name: 'frontmatter',
  description:
    'preserve YAML metadata while editing the document body visually.',
  apiVersion: 1,
  defaultEnabled: true,
} satisfies AddonManifest
