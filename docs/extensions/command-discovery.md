# command discovery

the command palette includes app actions, settings categories, individual settings, formatting and addon toolbar actions, addon enable/disable actions, addon settings, and available colorschemes. selecting a setting opens its category, scrolls to its row, and focuses its control. selecting a colorscheme applies it.

extensions and themes are discovered from the addon registry. declare `manifest.kind` as `extension` or `theme`; omitted values keep the api v1 extension behavior. no extra palette registration is needed for enabling an addon or opening its settings. colorschemes registered through `context.colorschemes.register` appear automatically and disappear when disposed.

use the shared `SettingRow` with a unique control `id` in addon settings. these rows are indexed automatically, including settings pages that have not been visited. settings components stay mounted while their addon is enabled, including while hidden; avoid work that requires visibility in a mount effect. the host removes their entries when the addon stops. arbitrary custom layouts still have a settings-page command; use `SettingRow` to expose individual controls.

registered commands accept optional `keywords` for search. toolbar actions also appear when applicable and enabled. disposal removes both toolbar and palette entries. disabled actions are omitted rather than executed from an invalid context.

the shared `Slider` keeps native range semantics and keyboard support, while providing a consistent themed track, progress, and thumb. switches and range thumbs use `--radius-round`; rectangular controls retain `--radius-control`.
