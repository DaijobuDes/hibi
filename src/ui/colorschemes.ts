import { bundledColorschemes } from '../shared/color-palettes'
import {
  COLOR_TOKENS,
  type Colorscheme,
  type ColorschemeInput,
  DEFAULT_THEME,
  defineColorscheme,
  type NativeAppearance,
  type ThemePreferences,
  themePreferences,
} from '../shared/colorschemes'

/** The main window's resolved colorscheme, including ones registered by addons. */
export const activePaletteKey = 'hibi:active-palette'

export function publishActivePalette(scheme: Colorscheme) {
  try {
    localStorage.setItem(
      activePaletteKey,
      JSON.stringify({ appearance: scheme.appearance, colors: scheme.colors }),
    )
  } catch {
    /* Other windows keep their bundled colorscheme. */
  }
}

/** Apply the published palette to `style`; false when none is stored or it is invalid. */
export function applyActivePalette(style: HTMLStyleElement): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(activePaletteKey) ?? 'null')
    const colors: unknown = value?.colors
    if (
      !['light', 'dark'].includes(value?.appearance) ||
      !colors ||
      typeof colors !== 'object'
    )
      return false
    const entries = Object.entries(colors)
    if (
      !entries.every(
        ([token, color]) =>
          COLOR_TOKENS.includes(token as (typeof COLOR_TOKENS)[number]) &&
          typeof color === 'string' &&
          /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color),
      )
    )
      return false
    document.documentElement.dataset.appearance = value.appearance
    style.textContent = `:root { color-scheme: ${value.appearance}; ${entries.map(([token, color]) => `--${token}: ${color};`).join(' ')} }`
    return true
  } catch {
    return false
  }
}

export function createColorschemeStore(
  storageKey: string,
  initial?: unknown,
  persistent = true,
) {
  const schemes = new Map(
    bundledColorschemes.map((scheme) => [scheme.id, scheme]),
  )
  let preferences = themePreferences(initial)
  try {
    preferences = themePreferences(
      persistent
        ? JSON.parse(
            localStorage.getItem(storageKey) ?? JSON.stringify(preferences),
          )
        : initial,
    )
  } catch {
    /* Use the bundled defaults when storage is unavailable. */
  }
  const media = matchMedia('(prefers-color-scheme: dark)')
  const listeners = new Set<() => void>()
  const style = document.createElement('style')
  style.dataset.colorscheme = storageKey
  let started = false
  const selected = (appearance: 'light' | 'dark') => {
    const scheme = schemes.get(preferences[appearance])
    if (scheme?.appearance === appearance) return scheme
    const fallback = schemes.get(DEFAULT_THEME[appearance])
    if (!fallback) throw new Error('missing built-in colorscheme')
    return fallback
  }
  const current = () =>
    selected(
      preferences.mode === 'system'
        ? media.matches
          ? 'dark'
          : 'light'
        : preferences.mode,
    )
  let snapshot = {
    preferences,
    schemes: [...schemes.values()],
    active: current(),
  }
  const publish = () => {
    snapshot = {
      preferences,
      schemes: [...schemes.values()],
      active: current(),
    }
    if (started) {
      document.documentElement.dataset.colorscheme = snapshot.active.id
      document.documentElement.dataset.appearance = snapshot.active.appearance
      style.textContent = `@layer hibi-theme { :root { color-scheme: ${snapshot.active.appearance}; ${COLOR_TOKENS.map((key) => `--${key}: ${snapshot.active.colors[key]};`).join(' ')} } }`
    }
    for (const listener of listeners) listener()
  }
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey) return
    try {
      preferences = themePreferences(JSON.parse(event.newValue ?? 'null'))
      publish()
    } catch {
      /* Ignore malformed changes from other windows. */
    }
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      if (started) return
      started = true
      document.head.append(style)
      media.addEventListener('change', publish)
      if (persistent) window.addEventListener('storage', storage)
      publish()
    },
    stop() {
      started = false
      style.remove()
      media.removeEventListener('change', publish)
      window.removeEventListener('storage', storage)
    },
    set(changes: Partial<ThemePreferences>) {
      const next = themePreferences({ ...preferences, ...changes })
      for (const mode of ['light', 'dark'] as const)
        if (
          changes[mode] !== undefined &&
          schemes.get(next[mode])?.appearance !== mode
        )
          throw new Error(`choose a ${mode} colorscheme`)
      preferences = next
      try {
        if (persistent)
          localStorage.setItem(storageKey, JSON.stringify(preferences))
      } catch {
        /* The current session still applies the choice. */
      }
      publish()
    },
    register(input: ColorschemeInput) {
      const scheme = defineColorscheme(input)
      if (schemes.has(scheme.id))
        throw new Error(`duplicate colorscheme: ${scheme.id}`)
      schemes.set(scheme.id, scheme)
      publish()
      let active = true
      return () => {
        if (!active) return
        active = false
        schemes.delete(scheme.id)
        publish()
      }
    },
    native(): NativeAppearance {
      const light = selected('light').colors
      const dark = selected('dark').colors
      return {
        preferences,
        light: { background: light.background, foreground: light.ink },
        dark: { background: dark.background, foreground: dark.ink },
      }
    },
  }
}
export type ColorschemeStore = ReturnType<typeof createColorschemeStore>
