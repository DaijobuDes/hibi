import { defineAddon } from '../api'
import { CaptureWindow } from './CaptureWindow'
import { captureWindow } from './capture'
import manifest from './manifest'
import { readSettings, settingsChanged } from './settings'

let stopSettings: (() => void) | undefined

export default defineAddon({
  manifest,
  windows: { capture: CaptureWindow },
  async start(context) {
    context.commands.register({
      id: 'capture',
      label: 'Quick note: capture',
      keywords: 'note inbox global shortcut',
      run: async () => {
        await context.windows.open(captureWindow)
      },
    })
    let removeShortcut: (() => void) | undefined
    let generation = 0
    async function updateShortcut() {
      const current = ++generation
      removeShortcut?.()
      removeShortcut = undefined
      const shortcut = readSettings().shortcut.trim()
      if (!shortcut) return
      try {
        const remove = await context.globalShortcuts.register(
          'capture',
          shortcut,
          'capture',
        )
        if (current === generation) removeShortcut = remove
        else remove()
      } catch (error) {
        context.notify(
          error instanceof Error
            ? `Quick note shortcut unavailable: ${error.message}`
            : 'Quick note shortcut unavailable.',
        )
      }
    }
    // The host rejects a registration while the previous one is in flight.
    let updates = Promise.resolve()
    let stopped = false
    const update = () => (stopped ? undefined : updateShortcut())
    const changed = () => {
      updates = updates.then(update, update)
      return updates
    }
    window.addEventListener(settingsChanged, changed)
    stopSettings = () => {
      stopped = true
      generation++
      window.removeEventListener(settingsChanged, changed)
      removeShortcut?.()
    }
    await changed()
  },
  stop() {
    stopSettings?.()
    stopSettings = undefined
  },
})
