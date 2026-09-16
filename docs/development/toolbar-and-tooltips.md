# toolbar and tooltips

## toolbar

`context.toolbar.register(item)` adds an action to the separate row below the top bar. local ids are prefixed with the addon id. duplicate or invalid ids throw. the returned handle supports `update(partial)` and `dispose()`. the host removes items on disable, failed startup, and hot reload; disposed handles and callbacks become inert. asynchronous callback errors use the app's error notification.

```ts
import { Volume2 } from 'lucide-react'

const action = context.toolbar.register({
  id: 'sound', label: 'mute sounds', icon: Volume2,
  tooltip: 'mute keyboard sounds', pressed: false,
  onClick() { action.update({ pressed: true }) },
})
```

`when: 'normal'` shows an action in normal and split views. `when: 'source'` shows it in markdown and split views. omitted `when` shows it in every editor view. settings never show the editor toolbar. empty toolbars occupy no space. icons are optional; icons-only mode uses a puzzle icon when none is supplied. labels always remain accessible.

`getPreferences()` returns `{ visible, mode, order?, autoHide? }`. `setPreferences(partial)` changes the shared, persistent preference. `mode` accepts `icons`, `icons-and-text`, or `text`. `order` is an array of fully qualified item ids such as `format.bold` and `keybeats.mute`; duplicates and invalid ids are ignored. unlisted/new actions follow registration order, and temporarily disabled addons retain their saved places. an empty order restores defaults. returned order arrays are copies. these optional fields preserve API version 1.

the renderer measures actual button widths and keeps overflow actions in an ellipsis menu, in their saved order. it adapts to sidebar width, fonts, and icons/text mode without horizontal scrolling. the toolbar uses one inset surface (12 px horizontally, 4 px vertically); individual buttons show backgrounds only on hover/active. overflow supports arrow keys, home/end, escape, and outside dismissal.

appearance settings expose visibility, display mode, and **arrange toolbar actions**. drag rows or use their up/down buttons, then return to the editor; changes save immediately. the toolbar itself also accepts drag reordering. reset order restores the default arrangement without changing display mode or visibility.

`hidden: true` hides a context-specific action while preserving its place in settings. the built-in formatting controls use the same registration API as addons, share their ordering and appearance, and follow the active editor pane. table structure actions appear when editing a rich-text table. unavailable actions are disabled. hiding the toolbar does not disable addons or their commands. the find bar sits under the visible toolbar and its small bottom margin, or directly under the top bar when no toolbar is shown.

`autoHide` defaults to true. the toolbar and top bar share one editor-activity signal and 1.2-second idle timer. each has its own appearance setting. the toolbar's slide uses the same `--motion-feedback` duration as the top bar. its surface and icons fade out during the first half of collapse, then fade in after expansion begins, finishing with the slide. this avoids a clipped reveal. collapsing its layout moves the editor up smoothly, and expansion moves it back down. the hidden row is inert and excluded from keyboard navigation. pointer movement to the top of the window, chrome focus, find, palette, and settings reveal both. reduced motion removes the transitions.

## tooltips

`context.tooltips.show({ anchor, text, placement? })` shows plain text next to a DOM element and returns a function that hides that request. `placement` is `top` or `bottom` (default); the host fits it within the viewport. `hide()` dismisses only the calling scope's tooltip. disabling an addon dismisses its tooltip without affecting another addon's newer request.

```tsx
import { Button, Tooltip, useTooltips } from '../ui'

<Tooltip text="export this workspace"><Button>export</Button></Tooltip>

// Built-in imperative usage; addons use context.tooltips instead.
const tooltips = useTooltips()
const hide = tooltips.show({ anchor: buttonElement, text: 'ready to export' })
```

`Tooltip` clones one child without a layout wrapper; custom children must forward data attributes to their DOM element. shared `Button` and `IconButton` convert their `title` prop into this tooltip. `data-tooltip` also works directly. hover waits 400 ms, keyboard focus shows immediately, and touch does not open hover tooltips. escape, pointer down, leaving the control, scrolling, resizing, and window blur dismiss them. the tooltip temporarily adds its id to `aria-describedby` and preserves existing ids. text stays inert; markup is never executed.

the shared `DialogProvider` mounts one `TooltipHost`. standalone renderers can mount the host explicitly. native popovers keep tooltips above native modal dialogs without blocking clicks. transitions respect reduced motion and use shared color/radius/timing tokens.

see [toolbar types](../reference/toolbar-api.md) and [tooltip types](../reference/tooltip-api.md). both additions preserve addon API version 1.
