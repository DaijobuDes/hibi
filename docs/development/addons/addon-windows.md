# Addon windows

An addon compiled with Hibi can open its own desktop windows, such as a capture window that appears over other applications. Each window shows a component from your addon definition and runs in a separate renderer. Sideloaded packages cannot open windows yet.

## Define the window content

List window components by local ID in the `windows` field of your addon. Hibi loads your addon module in the new window and renders the component. It finds the module by folder, so the folder must be named after your manifest `id`. It does not call your addon's `start` there, so commands, shortcuts, settings, and other registrations from `start` do not exist in the window. A window that shows Hibi's editor is the one exception for document addons, described below.

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

## Show Hibi's editor

Render `props.Editor` to give a window Hibi's editor and formatting toolbar for one untitled Markdown note. It reads `defaultValue` once and reports each change through `onChange`; the note exists only in memory until your addon saves it, for example with a native method.

```tsx
function Capture({ Editor, native, close }: AddonWindowProps) {
  const text = useRef('')
  return (
    <>
      <Editor label="Note" onChange={(markdown) => (text.current = markdown)} />
      <button onClick={() => void native.invoke('save', text.current).then(close)}>Save</button>
    </>
  )
}
```

The first render starts an editor host inside the window:

- The editor uses the same Markdown format, flavors, syntax, and code languages as the main window. To provide them, Hibi starts the enabled addons that an untitled Markdown document needs in the main window. Background addons, command-activated addons, and sideloaded packages never start in a window. Their `start` runs with the same `AddonContext` as in the main window, so registrations made there apply only inside that window. Turning an addon on or off in settings starts or stops it in open and hidden editor windows too.
- The window has no access to Hibi's desktop bridge. Its `window.hibi` is a local stand-in: edits stay in the window's memory, addon states are read from the main process, workspace lookups return nothing, event listeners never fire, and every other request is refused with "not available in this window". Through this stand-in, code in the window cannot read or change files, the open document, or the workspace, and the window never runs workspace content. Your own native methods remain reachable from the window, so they can still save files, as in the example above.
- The addons started for the editor run in your window's renderer, as all enabled addons share the main renderer. When the window opens, before any addon code loads, Hibi takes the window's bridge out of the global scope, so other addons cannot call your native handlers through it. This is not a sandbox: code in the same renderer can still reach your component and its props. Treat your window's native methods as available to every addon that runs in the window, just as they are to every addon in the main window.
- Appearance, colorschemes, cursor style, spell check, line numbers, Markdown marker, and toolbar preferences come from the user's settings, and changes apply to open windows.

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

Set `keepAlive: true` for a window people open often. Closing it then hides it and keeps its renderer and state for ten minutes, so reopening within that time is immediate; `onClosed` still reports each close. A hidden window that shows Hibi's editor holds roughly 160 MB, so Hibi releases it after ten minutes and the next open starts it again. To prepare a window before it is first needed, call `open` with `show: false`. Do this only when the window is likely to be used soon, because the memory is held until then.

Hibi closes an addon's windows when the addon is disabled, and when quitting is confirmed. Closing the main window leaves visible addon windows open; on Windows and Linux it releases hidden kept-alive windows so that Hibi can quit.

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
