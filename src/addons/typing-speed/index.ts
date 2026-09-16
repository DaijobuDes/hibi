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
      label: '0 wpm',
      tooltip: 'last 60 seconds · one word = five characters',
    })
    const characters = context.statusBar.register({
      id: 'cpm',
      label: '0 cpm',
      tooltip: 'characters typed in the last 60 seconds · excludes paste',
    })
    const refresh = () => {
      const value = speed.read(performance.now())
      words.update({ label: `${value.wpm} wpm` })
      characters.update({ label: `${value.cpm} cpm` })
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
