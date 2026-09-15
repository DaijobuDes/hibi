# frontmatter

enabled by default; toggle it in settings → addons.

normal and split views show a collapsible properties editor above the body. text, multiline text, numbers, and booleans have editable fields. add properties with a name and type, or remove them with the row action. lists, objects, aliases, and unusual YAML values open in the yaml editor; apply validates YAML before changing the note. cancel leaves it untouched. duplicate keys are rejected. if metadata changes in markdown while a yaml draft is open, cancel and reopen it before applying.

properties use compact in-page rows: type icons and names on the left, inline values on the right, and quiet hover/focus actions. simple lists display as tags. **add property** opens a name and type row. collapsed properties animate without changing their values.

use **add frontmatter** in the command palette to create properties on a note without metadata. it inserts an explicit empty mapping (`{}`) and preserves the existing body. recognition requires a closed YAML mapping: a leading `---`, ordinary dividers, empty divider pairs, and unfinished blocks remain regular Markdown.

body edits retain metadata verbatim. field edits use the [yaml document API](https://eemeli.org/yaml/#documents) to preserve comments, value types, nested structures, and anchors. formatting inside metadata may normalize after field edits; document delimiters, line endings, surrounding spacing, and body content stay intact. invalid YAML stays untouched until explicitly repaired in the yaml editor.

the addon registers a markdown projection and optional `Editor` component through `context.editor.registerMarkdown`. its command uses `context.editor.updateMarkdown`. disabling the addon removes its UI and command, preserves the document, and leaves recognized metadata-bearing files editable in markdown view.

settings → plugins → frontmatter controls whether properties open expanded for new editor sessions. version and author credits appear under settings → addons.
