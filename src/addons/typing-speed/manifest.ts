import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'typing-speed',
  name: 'typing speed',
  version: '1.1.0',
  apiVersion: 1,
  description:
    'estimated words and characters per minute for this typing session.',
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
