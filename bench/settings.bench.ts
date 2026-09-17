import { bench, describe } from 'vitest'
import { bundledColorschemes } from '../src/shared/color-palettes.ts'
import {
  defineColorscheme,
  themePreferences,
} from '../src/shared/colorschemes.ts'
import {
  defaultHotkeys,
  restoreHotkeys,
  shortcutFromEvent,
  shortcutLabels,
  validateHotkeys,
} from '../src/shared/hotkeys.ts'
import { sentenceCase } from '../src/shared/ui-case.ts'

// Settings, themes and hotkeys are rebuilt whenever preferences or addons change.
const palette = {
  id: 'bench-scheme',
  name: 'Bench scheme',
  appearance: 'dark' as const,
  author: 'bench',
  license: { name: 'Bench', text: 'Fixture palette used by the benchmarks.' },
  colors: {
    background: '#181818',
    surface: '#222222',
    ink: '#e4e9e9',
    muted: '#9aa5a5',
    accent: '#7fd1cc',
    border: '#333333',
  },
}
const stored: Record<string, unknown> = {
  _version: 1,
  palette: 'meta+k',
  save: 'meta+s',
  find: 'meta+f',
  unknown: 'meta+j',
}
const linuxDefaults = defaultHotkeys('linux')
const labels = [
  'open settings',
  'toggle the sidebar',
  'reset wpm counter',
  'export as pdf',
  'https://codspeed.io',
  'docs/reference/menu-api.md',
  'show yaml frontmatter',
]

describe('colorschemes', () => {
  bench('derive one colorscheme', () => {
    defineColorscheme(palette)
  })

  bench('derive every bundled colorscheme', () => {
    for (const scheme of bundledColorschemes) defineColorscheme(scheme)
  })

  bench('validate stored theme preferences', () => {
    themePreferences({ mode: 'dark', light: 'hibi-light', dark: 'nord' })
  })
})

describe('hotkeys', () => {
  bench('restore stored hotkeys', () => {
    restoreHotkeys(stored, 'darwin')
  })

  bench('validate a complete hotkey set', () => {
    validateHotkeys(linuxDefaults, 'linux')
  })

  bench('label a shortcut for the ui', () => {
    shortcutLabels('meta+shift+arrowup', 'darwin')
  })

  bench('read a shortcut from a key event', () => {
    shortcutFromEvent({
      key: 'k',
      code: 'KeyK',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: true,
    })
  })
})

describe('ui case', () => {
  bench('sentence case ui labels', () => {
    for (const label of labels) sentenceCase(label)
  })
})
