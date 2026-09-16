import { defineAddon } from '../api'
import manifest from './manifest'
import { mathFlavor } from './syntax'
export default defineAddon({
  manifest,
  flavors: [mathFlavor],
  async start(context) {
    ;(await import('./engine')).startMath(context)
  },
})
