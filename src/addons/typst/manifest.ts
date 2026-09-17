import notice from '../../../docs/licenses/typst-assets.md?raw'
import type { AddonManifest } from '../api'
import { authors } from '../authors'

export default {
  id: 'typst',
  name: 'typst',
  kind: 'extension',
  version: '1.0.0',
  apiVersion: 1,
  description:
    'typst documents, live previews, pdf export, and rendered markdown blocks.',
  defaultEnabled: false,
  fileExtensions: ['typ'],
  authors: [
    authors.may,
    {
      displayName: 'typst contributors',
      github: 'typst',
      role: 'typesetting engine',
    },
    {
      displayName: 'myriad-dreamin',
      github: 'Myriad-Dreamin',
      role: 'typst.ts compiler bindings',
    },
  ],
  licenses: [
    {
      id: 'typst-assets',
      name: 'typst bundled fonts and assets',
      license: 'see notices',
      text: notice,
    },
  ],
} satisfies AddonManifest
