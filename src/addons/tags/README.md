# tags

optional extension by may (`1262793452236570667`), version 1.0.0. enable in settings → addons.

The tag browser uses the shared sidebar, with a pinnable view shortcut and the standard resize handle. Tag clicks select the tag in that view; opening a note keeps the browser visible. Tag counts update from the active draft in memory. Workspace reads are debounced and subscriptions stop while the view is hidden.

Unchanged notes reuse their parsed tags; typing reindexes only the changed note.

write `#tag` in markdown prose. unicode letters, numbers, underscores, hyphens, and nested names such as `#work/project` are supported; purely numeric tags are ignored. matching is case-insensitive. headings, escaped hashes, code, html, urls/link labels, and frontmatter are not indexed as tags.

Tags are highlighted in normal and source panes. Shift-click one, use the sidebar view picker, or run **browse tags** to open the tag browser. The status pill appears only when the current note has tags: it shows their count and lists them on hover. Clicking that count opens the browser. Filter tags, select one, then open a matching workspace note. Workspace changes, active drafts, and window focus refresh the browser automatically. Empty results use a centered explanation; the notes section appears after selecting a tag with matches. Opening another note keeps the app's unsaved-change checks.

tags remain ordinary markdown when disabled or exported. the plugin stores no index on disk, sends nothing to a server, and uses the shared workspace snapshot limits. drafts without a workspace path are shown in the status pill but are not included in workspace results.
