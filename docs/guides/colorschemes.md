# colorschemes

open **settings → appearance**. choose **system**, **light**, or **dark**, then choose a palette for each appearance. system follows the operating system and switches between your chosen pair. hibi light and dark remain the defaults.

## included palettes

- **hibi light / dark**: hibi's original neutral surfaces and teal accent.
- **vscode light modern / dark modern**: familiar neutral editor colors with blue accents, adapted from Microsoft's source themes.
- **catppuccin latte / frappé / macchiato / mocha**: one light and three dark pastel palettes, with mauve accents.
- **nord**: dark blue-gray surfaces with cool blue accents.

the palette covers window content, sidebar, settings, dialogs, search, selection, caret, markdown syntax, and rendered documents. changing colors does not rebuild editors or reset undo history. native window backgrounds and caption controls follow the selected appearance too. preferences survive restarts; addon palettes fall back to hibi when their addon is disabled and return when enabled again.

## exported documentation

exports include all nine built-in palettes and the author's appearance preferences. readers can open the palette button in the top bar and save their own choice in browser storage. this works offline. browser preferences take precedence over the author's defaults.

addon palette code and CSS overrides are not copied into exports. if an author selected an addon palette, the exported site uses hibi for that appearance. select a bundled palette before exporting to carry its colors across.

## credits and licenses

the seven adapted third-party palettes use MIT-licensed source colors. full notices and pinned upstream revisions are retained in [catppuccin](../licenses/catppuccin.md), [vscode](../licenses/vscode.md), and [nord](../licenses/nord.md). notices ship with packaged apps and exported HTML, and can be read under **license and credits** in appearance settings. no upstream logos are bundled.

colors are mapped to hibi's semantic roles rather than importing another editor's theme engine. selected-row surfaces and latte's accent/link colors are adjusted for readable text contrast. these are hibi adaptations, not exact reproductions or officially endorsed ports.

see [addon colorschemes](../development/addons.md#colorschemes) to register more palettes.
