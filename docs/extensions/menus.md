# popover menus

`context.menus.open({ label, anchor, items })` opens the shared non-native app menu. `anchor` is an element or viewport `{ x, y }` point. each item supplies a local `id`, `label`, and `onSelect`; optional `icon`, `disabled`, and `separatorBefore` fields control presentation. callbacks may return promises; the host closes the menu before running an action and reports failures.

the returned handle has `close()`. outside click, escape, and tab dismiss the menu. arrow keys and home/end move focus among enabled actions. the menu stays inside the viewport. stopping an addon closes its menu and prevents stale actions from running.

workspace entries use this same menu. keyboard users can open it with shift+f10 or the context-menu key. built-ins use `useMenus` from the shared ui host; only one menu is open at a time.
