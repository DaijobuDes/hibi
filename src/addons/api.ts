import type { WorkspaceSnapshot, WorkspaceState } from '../shared/workspace'

/** Increment when a public contract changes incompatibly. */
export const ADDON_API_VERSION = 1

export type AddonManifest = {
  id: string
  name: string
  description: string
  apiVersion: typeof ADDON_API_VERSION
  defaultEnabled?: boolean
}

export type AddonCommand = {
  /** Local id; the host prefixes it with the addon id. */
  id: string
  label: string
  /** Also show this command below the workspace tree. */
  workspace?: boolean
  run: () => void | Promise<void>
}

export type ExportResult = { path: string; pages: number }
export type AddonState = { id: string; enabled: boolean }

export type AddonContext = {
  commands: { register: (command: AddonCommand) => () => void }
  workspace: {
    get: () => Promise<WorkspaceState | null>
    open: () => Promise<WorkspaceState | null>
    openFile: (path: string) => Promise<void>
  }
  /** Calls only the current addon's explicitly exported native methods. */
  native: {
    invoke: <T = unknown>(method: string, input?: unknown) => Promise<T>
  }
  notify: (message: string) => void
}

export type Addon = {
  manifest: AddonManifest
  start: (context: AddonContext) => void
  stop?: () => void
}

/** Native modules are trusted application code, never loaded from a workspace. */
export type NativeAddonContext = {
  workspace: { snapshot: () => Promise<WorkspaceSnapshot> }
  exportHtml: (
    html: string,
    suggestedName: string,
    pages: number,
  ) => Promise<ExportResult | null>
}

export type NativeAddon = {
  id: string
  methods: Record<
    string,
    (input: unknown, context: NativeAddonContext) => Promise<unknown>
  >
}

export function defineAddon(addon: Addon): Addon {
  return addon
}

export const ADDON_CHANNELS = {
  states: 'addons:states',
  enable: 'addons:enable',
  invoke: 'addons:invoke',
} as const
