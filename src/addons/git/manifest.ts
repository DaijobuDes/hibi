import type { AddonManifest } from '../api'
import { authors } from '../authors'
export default {
  id: 'git',
  name: 'git',
  kind: 'extension',
  version: '1.1.0',
  apiVersion: 1,
  description:
    'explorer status markers, diffs, staging, commits, branches, pull, and push.',
  defaultEnabled: false,
  authors: [authors.may],
} satisfies AddonManifest
