# graph and tags

enable **graph** and/or **tags** in settings → addons. both are optional, local extensions with palette commands, toolbar buttons, and status pills.

## graph

**open workspace graph** shows notes connected by existing markdown links such as `[next](notes/next.md)`. click a note to open it; drag nodes or the background; scroll to zoom. buttons zoom and fit the view. **current note** shows only the open note and its direct connections. filter by filename/path or refresh after changes.

keyboard: tab to a node and press enter/space to open it; arrows pan when the graph background has focus. opening notes keeps normal unsaved-change checks. no files or layouts are changed by moving nodes. the graph displays up to 500 matching nodes; narrow the filter for larger folders. wikilinks are not supported by this version.

## tags

write `#work`, `#project/topic`, or another tag in prose. names match without case sensitivity. code, escaped hashes, headings' `#` markers, links, html, and frontmatter are excluded. `#123` is not a tag.

shift-click a highlighted tag or run **browse tags**. select a tag to see matching notes, then click a filename to open it. the status pill counts tags in the current note, including unsaved changes. workspace results include the active saved note's unsaved edits; unsaved drafts without a path do not appear in the workspace index. source text is unchanged, so tags remain plain markdown when disabled or exported.

both panels refresh on workspace file changes and use the existing bounded workspace snapshot. see the [graph](../../src/addons/graph/README.md) and [tags](../../src/addons/tags/README.md) extension readmes for limits and credits.
