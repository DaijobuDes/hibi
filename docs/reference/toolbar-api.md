# toolbar api

generated from `src/ui/toolbar.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
import type { ComponentType } from 'react'

export type ToolbarPreferences = {
  visible: boolean
  mode: 'icons' | 'icons-and-text' | 'text'
}
export type ToolbarItem = {
  id: string
  label: string
  icon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  tooltip?: string
  disabled?: boolean
  pressed?: boolean
  when?: 'normal' | 'source'
  onClick: () => void | Promise<void>
}
export type ToolbarHandle = {
  update: (changes: Partial<Omit<ToolbarItem, 'id'>>) => void
  dispose: () => void
}
export type ToolbarApi = {
  register: (item: ToolbarItem) => ToolbarHandle
  getPreferences: () => ToolbarPreferences
  /** Changes the shared toolbar; preferences persist across app restarts. */
  setPreferences: (preferences: Partial<ToolbarPreferences>) => void
}
```
