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

`getPreferences()` returns `{ visible, mode }`. `setPreferences(partial)` changes the shared, persistent preference. `mode` accepts `icons`, `icons-and-text`, or `text`. built-in appearance settings expose both controls. hiding the toolbar does not disable addons or their commands. the find bar sits directly under the visible toolbar, or directly under the top bar when no toolbar is shown.

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
