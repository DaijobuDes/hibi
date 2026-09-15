# frontmatter

frontmatter is a bundled addon, enabled by default under settings → addons. it recognizes a YAML key/value mapping at the beginning of a document, opened with `---` and closed with `---` or `...`. typing `---` alone, unfinished blocks, and ordinary divider pairs do not activate it. empty metadata uses an explicit `{}` mapping.

normal and split views show a collapsible properties editor above the body. text, multiline text, numbers, and booleans have fields; lists and objects open in the yaml editor. add a property by name and type, or remove one from its row. **add frontmatter** in the command palette creates a metadata block on a note without one.

the editor uses compact page metadata rows with type icons, inline values, and tags for simple lists. property actions appear on hover or keyboard focus. **add property** opens the name and type inputs.

field edits apply immediately. raw yaml edits require **apply yaml**, which validates syntax before changing the document. **cancel** discards the yaml draft. if metadata changes in markdown view while a yaml draft is open, reopen the yaml editor to use the latest values.

body edits preserve metadata verbatim. metadata edits retain the body, delimiters, line endings, and surrounding spacing. field edits retain comments, anchors, and value types, but may normalize YAML formatting. markdown view always contains the whole file.

disabling the addon preserves the file and restores source-only editing for recognized metadata-bearing documents. unsupported body syntax remains protected from lossy visual edits. there is no compatibility banner.

settings → plugins → frontmatter controls whether properties start expanded when a note opens.

static documentation exports retain the original markdown; metadata values are not used as search or navigation configuration. the properties editor runs only inside the desktop addon.
