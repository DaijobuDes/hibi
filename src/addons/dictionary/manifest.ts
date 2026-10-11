import type { AddonManifest } from '../api'
import { authors } from '../authors'
import { packLicenses } from './pack-licenses'

export default {
  id: 'dictionary',
  name: 'Dictionary and thesaurus',
  version: '1.0.0',
  apiVersion: 2,
  description:
    'Look up English definitions and synonyms. Words you look up are sent to the Free Dictionary API and Datamuse.',
  defaultEnabled: false,
  startup: 'background',
  authors: [authors.may],
  licenses: packLicenses,
} satisfies AddonManifest
