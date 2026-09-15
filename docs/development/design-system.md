# shared ui and theme tokens

desktop and exported documentation use the same `src/ui/tokens.css`. its [generated reference](../reference/theme-tokens.md) is checked by `npm run docs:check`.

## semantic colors

`--background`, `--surface`, `--ink`, `--muted`, `--accent`, `--border`, and `--overlay` describe roles. light and dark defaults live together. components consume these roles instead of defining their own palette.

theme styles can override these variables on a root selector with greater specificity, such as `:root[data-theme="custom"]`. keep foreground/background contrast readable. a theme picker and theme-file loading are not implemented yet; Electron's native window controls still follow the system appearance.

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
- `IconButton`: file/view controls, find navigation, workspace actions, palette close, notification close, hotkey actions, and exported navigation share size, radius, and icon stroke.
- `ShortcutKeys`: every visible shortcut uses the same formatter and keycap styles.

these components are exported from `src/addons/ui.ts`. use them for new UI instead of copying their markup. grouped panels, input/select controls, notifications, and focus/hover states use the same semantic token values. short file operations mark the toolbar busy without flashing its icons.
