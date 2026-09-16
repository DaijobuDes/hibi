import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'math',
  name: 'math',
  kind: 'extension',
  version: '1.0.0',
  apiVersion: 1,
  description: 'optional inline and block latex, rendered locally with katex.',
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
