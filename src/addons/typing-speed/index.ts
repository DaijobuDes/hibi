import { defineAddon } from '../api'
import manifest from './manifest'
import { typingSpeed } from './speed'

let stop: (() => void) | undefined
export default defineAddon({
  manifest,
  start(context) {
    const speed = typingSpeed()
    const words = context.statusBar.register({
      id: 'wpm',
      label: '≈0 wpm',
      tooltip:
        'estimated session words/minute · five characters per word · resets after 5 seconds idle',
    })
    const characters = context.statusBar.register({
      id: 'cpm',
      label: '≈0 cpm',
      tooltip:
        'estimated session characters/minute · excludes paste · resets after 5 seconds idle',
    })
    const refresh = () => {
      const value = speed.read(performance.now())
      words.update({ label: `≈${value.wpm} wpm` })
      characters.update({ label: `≈${value.cpm} cpm` })
    }
    context.editor.onInput((event) => {
      speed.add(event.characters, performance.now())
      refresh()
    })
    const timer = setInterval(refresh, 1000)
    stop = () => clearInterval(timer)
  },
  stop() {
    stop?.()
    stop = undefined
  },
})
