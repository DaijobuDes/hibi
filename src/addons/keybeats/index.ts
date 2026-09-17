import { lazy } from 'react'
import { defineAddon } from '../api'
import manifest from './manifest'

let generation = 0
let stop: (() => void) | undefined
export default defineAddon({
  manifest,
  Settings: lazy(() =>
    import('./Settings').then(({ Settings }) => ({ default: Settings })),
  ),
  start(context) {
    const run = ++generation
    // Warm Chromium's audio service asynchronously; a cold AudioContext can
    // synchronously block editing while it queries the output device.
    void navigator.mediaDevices
      .enumerateDevices()
      .catch(() => undefined)
      .then(() => (run === generation ? import('./engine') : undefined))
      .then((module) => {
        if (module && run === generation) stop = module.startKeybeats(context)
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
