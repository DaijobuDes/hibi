import type { AddonManifest } from '../addons/api'
import type { ColorschemeInput } from './colorschemes'

export type InstalledAddon = {
  manifest: AddonManifest
  /** Versioned local module URL. Themes contain data only. */
  url: string | null
  themes: ColorschemeInput[]
}
export const SIDELOAD_CHANNELS = {
  list: 'addons:installed',
  install: 'addons:install',
  remove: 'addons:remove',
} as const
