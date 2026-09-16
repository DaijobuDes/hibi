# markdown flavors

addons are `theme` or `extension`. dialects and extra syntax are extension contributions, registered through `context.editor.registerFlavor`. a dialect can configure parsing and add rich-editor nodes; syntax such as math composes with it.

automatic mode recognizes enabled features. detection is a hint: ordinary markdown does not identify its dialect. click the status pill or search **markdown flavor** in the palette to override a file. choices persist per file and follow save-as and rename within hibi.

automatic mode keeps enabled parsers ready, so typing new syntax does not rebuild the editor or reset undo. explicit flavor changes and enabling/disabling schema extensions rebuild the rich editor while preserving source; this resets that pane's undo history. unsupported detected syntax remains editable in source mode and makes the rich pane read-only.

declare lightweight descriptors in `Addon.flavors` so bundled syntax remains detectable when disabled. register full contributions during `start`, including optional `richExtensions`, `markedOptions`, and `export` parsers/styles. shutdown disposes contributions. async `start` is supported; registrations after shutdown are ignored.

`context.editor.renderMarkdown(source, documentId?)` applies projections and the file's flavor preferences, returning `{ html, css }`. sanitize html before inserting it into a document. the exported documentation site does this while preserving safe mathml/svg. export styles/fonts should be self-contained: its content policy blocks network assets.

`context.workspace.snapshot()` returns the open folder's markdown pages, opaque file ids, and local image data. workspace files are data and cannot register flavors or execute code.

see the [addon api](../reference/addon-api.md), [github markdown](../../src/addons/github-markdown/README.md), and [math](../../src/addons/math/README.md).
