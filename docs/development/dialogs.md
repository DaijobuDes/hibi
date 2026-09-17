# dialogs and modals

addons use `context.dialogs`; built-in React components use `useDialogs()` from `src/ui/DialogProvider.tsx`. the app already provides one `DialogProvider`. both use the same queue, theme tokens, native focus trap, escape/outside dismissal, focus restoration, and reduced-motion behavior. the command palette also uses the shared `Modal` shell, exported from `src/addons/ui.ts` for declarative dialogs.

## helpers

```typescript
const name = await context.dialogs.prompt({
  title: 'name this page',
  label: 'name',
  defaultValue: 'untitled',
  validate: value => value.trim() ? null : 'enter a name.',
})
if (name === null) return
const confirmed = await context.dialogs.confirm({
  title: 'use this name?',
  description: name,
  confirmLabel: 'use name',
})
if (confirmed) await context.dialogs.alert({ title: 'name selected', description: name })
```

`alert` resolves when dismissed. `confirm` resolves `true` only from its confirm button; dismissal or addon shutdown returns `false`. `prompt` returns the entered string unchanged, or `null` on cancellation. its synchronous validator returns an error message or `null`. validation failures keep the prompt and entered text open.

## custom content

`open<T>({ title, description?, content, footer?, size?, closeOnOutsideClick? })` returns `{ result: Promise<T | null>, close(value?) }`. the `content({ close })` and optional `footer({ close })` render functions must be pure; render a component inside them when you need hooks. `size` is `normal` or `wide`; both fit the viewport. outside clicks dismiss by default and can be disabled for a form; escape and the close button remain available.

headers and optional footers stay visible while the body scrolls. compact headers center the title and close button on one row, with owner and description text below. they use the shared ui text size and 8 px vertical / 16 px horizontal padding in both the app and exported sites, aligned with the body content. modals share settings surfaces, typography, corners, buttons, and field controls. use `dialog-form` for forms: shared setting rows stack labels above full-width inputs so fields do not squeeze labels out of narrow dialogs. group related fields with `settings-group`. the link insertion form uses these same primitives; image insertion opens the native file picker.

```tsx
import { Button } from '../ui'

const dialog = context.dialogs.open<{ format: string }>({
  title: 'export options',
  content: ({ close }) => (
    <Button onClick={() => close({ format: 'html' })}>export html</Button>
  ),
})
const options = await dialog.result
```

## lifecycle

dialogs queue in request order. closing a queued dialog removes it immediately. stopping an addon closes its active and queued dialogs and resolves their results to `null`; a stopped addon's handles cannot reopen them. custom-content rendering errors are isolated behind a closeable error message. do not await a second queued dialog from inside the first without closing the first.

native file pickers and unsaved-file safeguards remain in the main process. `isOpen()` reports whether the shared dialog queue is occupied; built-in app shortcuts pause while it is occupied. use the addon-owned API from settings components too, by retaining the context supplied to `start`; reserve `useDialogs()` for built-ins. a directly rendered `Modal` follows its React component's lifetime.

see the generated [dialog API](../reference/dialog-api.md) and [modal component](../reference/modal-api.md).
