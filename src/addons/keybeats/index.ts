import { defineAddon } from '../api'
import manifest from './manifest'
import { Settings } from './Settings'

let generation = 0
let stop: (() => void) | undefined
export default defineAddon({
  manifest,
  Settings,
  start(context) {
    const run = ++generation
    void import('./engine')
      .then((module) => {
        if (run === generation) stop = module.startKeybeats(context)
      })
      .catch(() => {
        if (run === generation) context.notify('could not load keybeats.')
      })
  },
  stop() {
    generation++
    stop?.()
    stop = undefined
  },
})
