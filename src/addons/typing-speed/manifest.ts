import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'typing-speed',
  name: 'typing speed',
  version: '1.0.0',
  apiVersion: 1,
  description: 'words and characters typed in the last 60 seconds.',
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
