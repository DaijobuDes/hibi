import { createElement } from 'react'
import { FormatSettings, startFormat } from '../_shared/format-renderer'
import { formatSpec } from '../_shared/format-specs'
import { defineAddon } from '../api'
import manifest from './manifest'
import { mathFlavor } from './syntax'
export default defineAddon({
  manifest,
  flavors: [mathFlavor],
  Settings: () => createElement(FormatSettings, { spec: formatSpec(manifest) }),
  async start(context) {
    startFormat(context, formatSpec(manifest))
    ;(await import('./engine')).startMath(context)
  },
})
