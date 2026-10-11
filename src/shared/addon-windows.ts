export const ADDON_WINDOW_CHANNELS = {
  open: 'addon-windows:open',
  focus: 'addon-windows:focus',
  close: 'addon-windows:close',
  closed: 'addon-windows:closed',
  /** Requests from inside an addon window, scoped to the addon that owns it. */
  context: 'addon-windows:context',
  invoke: 'addon-windows:invoke',
  query: 'addon-windows:query',
} as const

export type AddonWindowOptions = {
  /** Local window ID. Opening the same ID again focuses the existing window. */
  id: string
  /** Defaults to the addon name. */
  title?: string
  /** Initial content size in pixels. Hibi keeps the size the user last chose on each display. */
  size?: { width: number; height: number }
  /** `cursor-display` opens near the top of the display with the pointer; `center` centers on that display. Defaults to `center`. */
  position?: 'cursor-display' | 'center'
  /** Keep the window above other applications. */
  alwaysOnTop?: boolean
  /** On macOS, float over full-screen apps on every Space and take keyboard focus without bringing Hibi forward. Ignored elsewhere. */
  panel?: boolean
  /** JSON value passed to the window component. Limited to 64 KB. */
  input?: unknown
}

/** Identity and input sent to an addon window's renderer. */
export type AddonWindowContext = {
  addonId: string
  id: string
  input: unknown
}

/** The only desktop requests available inside an addon window. */
export type AddonWindowBridge = {
  context: () => Promise<AddonWindowContext>
  query: (method: string, input?: unknown) => Promise<unknown>
  invoke: (method: string, input?: unknown) => Promise<unknown>
}
