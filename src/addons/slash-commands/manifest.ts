import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'slash-commands',
  name: 'slash commands',
  version: '0.1.0',
  authors: [authors.may],
  description: 'insert markdown blocks by typing / at the start of a line.',
  apiVersion: 1,
  defaultEnabled: true,
} satisfies AddonManifest
