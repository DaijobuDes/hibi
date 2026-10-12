# Addon windows

An addon compiled with Hibi can open its own desktop windows, such as a capture window that appears over other applications. Each window shows a component from your addon definition and runs in a separate renderer. Sideloaded packages cannot open windows yet.

## Define the window content

List window components by local ID in the `windows` field of your addon. Hibi loads your addon module in the new window and renders the component. It never calls `start` there, so commands, shortcuts, settings, and other registrations from `start` do not exist in the window.

```tsx
import { type AddonWindowProps, defineAddon } from '../api'

function Capture({ input, native, close }: AddonWindowProps) {
  return <button onClick={() => void native.invoke('save', input).then(close)}>Save</button>
}

export default defineAddon({
  manifest,
  windows: { capture: Capture },
  start(context) {
    context.commands.register({
      id: 'capture',
      label: 'Capture',
      run: () => context.windows.open({ id: 'capture', size: { width: 520, height: 420 } }),
    })
  },
})
```

The component receives only [AddonWindowProps](../addon-api-reference/AddonWindowProps.md): the JSON `input` given to `open`, your addon's own native queries and methods, and `close`. The window has no `window.hibi` bridge, so it cannot read documents, change the workspace, or call another addon's native handlers. Shared controls from `../ui` and Hibi's colorscheme work as they do in the main window. Dialogs, toasts, and tooltips from `AddonContext` are not available.

Native handlers called from a window receive that window as the parent for dialogs. Their document actions still apply to the main window, so keep window handlers to work that does not depend on the open document.

## Open and control a window

Call `context.windows.open()` with [AddonWindowOptions](../addon-api-reference/AddonWindowOptions.md). Opening an ID that is already open brings the existing window forward instead of creating another one; its original input is kept. An addon can have up to eight windows open.

```typescript
const capture = await context.windows.open({
  id: 'capture',
  title: 'Quick capture',
  position: 'cursor-display',
  panel: true,
  input: { folder: 'Inbox' },
})
capture.onClosed(() => console.log('closed'))
```

The returned [AddonWindowHandle](../addon-api-reference/AddonWindowHandle.md) can focus or close the window and report when it closes. Hibi remembers the size and position the user chooses for each window ID on each display. `position: 'cursor-display'` opens new windows near the top of the display with the pointer; `center` centers them on that display.

Set `titleBar: 'hibi'` to replace the system title bar with Hibi's compact bar, as in the main window. Hibi draws the window title in a draggable strip above your component and keeps the system window controls: inset on macOS and drawn over the bar's right edge on Windows and Linux. Your component fills the space below it.

Set `panel: true` for short tasks that should appear over whatever the user is doing. On macOS, a panel floats over full-screen apps on every Space and takes keyboard focus without bringing Hibi's main window forward. Other systems ignore `panel`; use `alwaysOnTop` to keep the window above other applications there.

Hibi closes an addon's windows when the addon is disabled. Closing the main window does not close addon windows.

## Open a window from a global shortcut

A renderer command needs Hibi's main window. To respond to a global shortcut while that window is hidden or closed, add a handler with the shortcut's local ID to `globalShortcuts` in your `native.ts`. Hibi runs it in the main process instead of showing the main window.

```typescript
export default {
  id: manifest.id,
  globalShortcuts: {
    capture: ({ windows }) => windows.open({ id: 'capture', panel: true }),
  },
  methods: {},
} satisfies NativeAddon
```

Register the shortcut from `start` as usual. The handler runs only while the addon is enabled.
