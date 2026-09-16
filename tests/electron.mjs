import { _electron } from 'playwright'

// Native windows still render for screenshots and input, but never take desktop focus.
export const electron = {
  launch(options) {
    return _electron.launch({
      ...options,
      args: [...options.args, '--hibi-test'],
    })
  },
}
