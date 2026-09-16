# dialog api

generated from `src/ui/dialogs.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
import type { ReactNode } from 'react'

export type DialogOptions<T> = {
  title: string
  description?: string
  size?: 'normal' | 'wide'
  closeOnOutsideClick?: boolean
  /** Use a component for content that needs React hooks. */
  content: (controls: { close: (value: T | null) => void }) => ReactNode
}

export type DialogHandle<T> = {
  /** Dismissal and owner shutdown resolve to null. */
  result: Promise<T | null>
  close: (value?: T | null) => void
}

export type MessageDialogOptions = {
  title: string
  description?: string
  confirmLabel?: string
}

export type PromptDialogOptions = MessageDialogOptions & {
  label: string
  defaultValue?: string
  placeholder?: string
  cancelLabel?: string
  /** Return an error message, or null when valid. Values are not trimmed. */
  validate?: (value: string) => string | null
}

export type DialogApi = {
  open: <T = void>(options: DialogOptions<T>) => DialogHandle<T>
  alert: (options: MessageDialogOptions) => Promise<void>
  confirm: (
    options: MessageDialogOptions & { cancelLabel?: string },
  ) => Promise<boolean>
  prompt: (options: PromptDialogOptions) => Promise<string | null>
  isOpen: () => boolean
}
```
