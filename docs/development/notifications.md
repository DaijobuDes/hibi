# notifications / sonner

one shared `Sonner` renders app and extension notifications. built-ins use `useToasts()` from `src/ui/Sonner.tsx`; extensions use `context.toasts`. `context.notify(message)` remains compatible and now uses the same service.

notifications default to bottom right and dismiss after five seconds. the bottom progress line shows remaining time. hovering or keyboard-focusing a notification pauses its timer; leaving resumes the remaining time once neither interaction is active. entrance slides upward with a fade; dismissal fades downward. reduced motion removes those transitions.

settings → appearance → notifications selects top/bottom and left/middle/right, plus a default timeout or **never**. these preferences persist locally and are automatically indexed in the command palette. top positions sit below window controls. timers already running keep their original duration; position changes move the current stack as well.

```typescript
const notice = context.toasts.show({
  message: 'exporting documentation…',
  description: 'preparing local pages',
  duration: 0,
})
notice.update({ message: 'documentation exported', description: '', variant: 'success', duration: 5000 })
// notice.dismiss() closes this notification; context.toasts.dismissAll() closes this addon's notices.
```

`show` accepts `message`, optional `description`, `variant` (`info`, `success`, or `error`), and `duration` in milliseconds. zero disables automatic dismissal and hides the progress line. `update` preserves remaining time unless a new duration is supplied. each notification always has a dismiss button. errors use an assertive live region; ordinary notices use polite announcements.

`getPreferences()` returns a copy; `setPreferences({ position, duration })` updates the shared window defaults. api position names use `center` for the middle column, for example `top-center`. durations are bounded to 0–600,000 ms. changing preferences affects future notifications' timeouts, not existing ones.

addon scopes own their notices. stopping/removing an extension cancels its timers and removes its notices; stale handles cannot revive them. notifications render in the active dialog's top layer so they remain readable and dismissible while a modal is open. no native desktop notification permission is needed.

see the generated [toast api](../reference/toast-api.md) and [dialog api](../reference/dialog-api.md).
