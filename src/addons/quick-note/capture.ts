import type { AddonWindowOptions } from '../api'

/** One capture window over other apps, without bringing Hibi forward. */
export const captureWindow = {
  id: 'capture',
  title: 'Quick note',
  size: { width: 640, height: 480 },
  position: 'cursor-display',
  titleBar: 'hibi',
  alwaysOnTop: true,
  panel: true,
  keepAlive: true,
} satisfies AddonWindowOptions
