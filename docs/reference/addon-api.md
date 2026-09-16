# addon api

generated from `src/addons/api.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
import type { Extension } from '@codemirror/state'
import type { ComponentType } from 'react'
import type { DocumentCommand } from '../shared/desktop'
import type { AppCommand } from '../shared/hotkeys'
import type { WorkspaceSnapshot, WorkspaceState } from '../shared/workspace'

/** Increment when a public contract changes incompatibly. */
export const ADDON_API_VERSION = 1

export type AddonManifest = {
  id: string
  name: string
  description: string
  apiVersion: typeof ADDON_API_VERSION
  defaultEnabled?: boolean
  /** Plugin release version; optional for existing API v1 addons. */
  version?: string
  authors?: readonly AddonAuthor[]
}

export type AddonAuthor = { discordId: string; displayName: string }

export type SourceExtension = {
  id: string
  /** Created per source editor; may lazy-load an editor integration. */
  create: () => Extension | Promise<Extension>
}

export type StatusItem = {
  id: string
  label: string
  tooltip?: string
  /** Omit to show in every editor view. Empty labels hide the pill. */
  when?: 'source'
  onClick?: () => void | Promise<void>
}
export type StatusHandle = {
  update: (changes: Partial<Omit<StatusItem, 'id'>>) => void
  dispose: () => void
}

export type StyleHandle = {
  update: (css: string) => void
  dispose: () => void
}

type Method = (...args: never[]) => unknown
type MethodKey<T> = {
  [K in keyof T]-?: T[K] extends Method ? K : never
}[keyof T]
type MethodOf<T, K extends keyof T> = Extract<T[K], Method>

/** Patches mutable renderer methods. Every registration returns an undo function. */
export type PatchApi = {
  before: <T extends object, K extends MethodKey<T>>(
    target: T,
    key: K,
    callback: (
      args: Parameters<MethodOf<T, K>>,
      receiver: T,
      // biome-ignore lint/suspicious/noConfusingVoidType: observer hooks may return nothing.
    ) => Parameters<MethodOf<T, K>> | void,
  ) => () => void
  after: <T extends object, K extends MethodKey<T>>(
    target: T,
    key: K,
    callback: (
      args: Parameters<MethodOf<T, K>>,
      result: ReturnType<MethodOf<T, K>>,
      receiver: T,
    ) => ReturnType<MethodOf<T, K>>,
  ) => () => void
  instead: <T extends object, K extends MethodKey<T>>(
    target: T,
    key: K,
    callback: (
      args: Parameters<MethodOf<T, K>>,
      next: (...args: Parameters<MethodOf<T, K>>) => ReturnType<MethodOf<T, K>>,
      receiver: T,
    ) => ReturnType<MethodOf<T, K>>,
  ) => () => void
}

/** Shared renderer actions used by the toolbar, palette, shortcuts, and addons. */
export type AddonApp = {
  runAction: (command: AppCommand) => void
  runCommand: (command: DocumentCommand) => Promise<boolean>
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

export type MarkdownProjection = {
  content: string
  serialize: (content: string) => string
  readOnly?: boolean
}
export type MarkdownExtension = {
  id: string
  /** Pure source-to-body projection; return null for unrecognized documents. */
  parse: (source: string) => MarkdownProjection | null
  /** Optional properties UI above the rich editor. Receives the complete source. */
  Editor?: ComponentType<MarkdownEditorProps>
}

export type MarkdownEditorProps = {
  value: string
  onChange: (source: string) => void
  disabled: boolean
}

export type AddonContext = {
  app: AddonApp
  styles: { register: (id: string, css: string) => StyleHandle }
  patches: PatchApi
  statusBar: { register: (item: StatusItem) => StatusHandle }
  editor: {
    registerMarkdown: (extension: MarkdownExtension) => () => void
    registerSource: (extension: SourceExtension) => () => void
    /** Uses the app's file dialogs, draft checks, and save handling. */
    runCommand: (command: DocumentCommand) => Promise<boolean>
    /** Apply a synchronous source transform to the active note; throws while busy. */
    updateMarkdown: (transform: (source: string) => string) => void
  }
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
  /** Optional settings content. The host supplies its heading and metadata. */
  Settings?: ComponentType
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
```
