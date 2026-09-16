# shared ui and theme tokens

shared `Modal` supplies native focus trapping and dismissal for the command palette and dialog API. `DialogProvider` supplies the window-level queue; app and addon dialogs share tokens, controls, spacing, motion, and reduced-motion handling.

titlebar titles receive 16 px of inset when no leading action icons are present. `--titlebar-edge-inset` and `--window-corner-radius` control outer chrome spacing. macOS reserves the traffic-light area and rounds the last button's top-right corner. Windows and Linux reserve right-side caption controls and adapt the first left button's top-left corner. platform selectors supply defaults; themes may override these tokens.

app and exported-site headers have an opaque page-colored backing, so scrolled settings, plugin pages, and document content cannot overlap their controls. its left edge follows the sidebar's slide and width, revealing the sidebar's own surface. resizing and reduced motion skip this transition. the backing stays in place from the first frame and needs no scroll listener.

desktop and exported documentation use the same `src/ui/tokens.css`. its [generated reference](../reference/theme-tokens.md) is checked by `npm run docs:check`.

## semantic colors

`--background`, `--surface`, `--sidebar`, `--ink`, `--muted`, `--accent`, `--border`, and `--overlay` describe surfaces and foregrounds. `--hover`, `--active`, `--selection`, `--selection-ink`, and `--caret` cover interaction. `--code-background`, `--code-ink`, and the `--syntax-*` roles cover source and rendered markdown. components consume these roles instead of defining their own palette.

`src/shared/color-palettes.ts` holds the nine bundled schemes. `src/ui/colorschemes.ts` applies them for both the app and static site without remounting editors. appearance settings persist a mode and a light/dark pair. Electron receives validated solid background/foreground colors and persists them before the next window is created.

base tokens live in CSS layer `hibi-base`; selected palettes live in `hibi-theme`. unlayered addon CSS overrides retain precedence. `:root[data-colorscheme="catppuccin-mocha"]` and `:root[data-appearance="dark"]` allow scoped overrides. use `context.colorschemes.register` for selectable palettes; arbitrary theme-file loading is not supported. preserve readable contrast. see [colorschemes](../guides/colorschemes.md) and the [generated contract](../reference/colorscheme-api.md).

## shared measurements

UI fonts, type sizes, spacing, control/panel radii, icon size, and motion durations use tokens. durations use milliseconds; the editor's text-fade animation reads `--motion-feedback` too. document typography, pane geometry, and user-selected padding/sidebar width remain separate from UI decoration. reduced-motion preferences override animations.

## shortcuts

use `ShortcutKeys` from `src/addons/ui.ts` in addons, or `src/ui/ShortcutKeys.tsx` in core UI. it uses the shared shortcut formatter and keycap styles in every surface: title bar, command rows, hotkey bindings, palette footer, and exported search. pass the effective binding and platform; do not render a separate `kbd` or hard-code a modifier symbol.

`--key-height`, `--key-min-width`, `--key-radius`, `--key-background`, `--key-ink`, and `--key-border` control all shortcut hints together. text tooltips also use the shared formatter. exported documentation always uses its own cmd/ctrl+k binding.

## settings

group related rows on one surface with inset separators. each row puts its label and description on the left and its control on the right. controls wrap inside narrow panels, including when the sidebar is widened. keep native input semantics, labels, descriptions, and keyboard focus behavior.

## reusable components

- `Sidebar`: settings categories, workspace tree, and exported navigation share row height, selection motion, focus behavior, and resize controls.
- `SettingRow`: padding, cursor, line-number, window, and addon settings share label/description layout and spacing.
- `Toggle`: native checkbox semantics with one switch style for all settings.
- `Button`: bordered text actions, including resets and apply/cancel actions.
- `Select`: native keyboard/menu behavior with one shared chevron and spacing.
- `IconButton`: file/view controls, find navigation, workspace actions, palette close, notification close, hotkey actions, and exported navigation share size, radius, and icon stroke.
- `ShortcutKeys`: every visible shortcut uses the same formatter and keycap styles.

sidebar items may introduce a section label. selection offsets include both row and section-height tokens, keeping plugin pages aligned while keyboard navigation skips the labels. app and Electron versions live as small text in the settings sidebar footer.

plugin status items use one bottom-left pill style through `context.statusBar`. the bar appears only when visible items exist and reserves space below the editor page. it moves and resizes with that page; the workspace sidebar remains full-height beside it.

these components are exported from `src/addons/ui.ts`. use them for new UI instead of copying their markup. grouped panels, input/select controls, notifications, and focus/hover states use the same semantic token values. short file operations mark the toolbar busy without flashing its icons.
