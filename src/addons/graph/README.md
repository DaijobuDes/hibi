# graph

optional extension by may (`1262793452236570667`), version 1.0.0. enable in settings → addons, then use **open workspace graph** in the palette, toolbar, or sidebar view picker. graph does not add a static status-bar shortcut.

The graph opens in the shared sidebar, with a pinnable view shortcut and the standard resize handle. Opening a note keeps the graph beside the editor. Hiding or switching the view stops its simulation and subscriptions. Workspace reads are debounced; typing updates the active draft in memory without rescanning files.

Unchanged notes reuse parsed links. Editing prose without changing links keeps the graph layout steady.

notes are nodes; local markdown links create connections. relative paths, workspace-root paths, encoded filenames, and reference links resolve to existing workspace files. external links, images, code examples, missing destinations, and self-links do not create connections. wikilinks (`[[note]]`) are not part of this version.

The sidebar contains a square graph preview. Expand opens a centered, wide modal; the sidebar simulation pauses until it closes. Selecting a node opens its note and centers it at the current zoom in either view. The modal stays open while selecting notes. The selected node remains centered while the layout settles; panning, dragging, scrolling, or Fit graph releases that centering. **Connections** lists notes linked to or from the current note, independent of the graph filter. Click a connection to open its note with the normal unsaved-change checks. Drag nodes to arrange them; drag the background to pan; scroll or use the buttons to zoom and fit. Keyboard users can tab to nodes and press enter/space, or use arrow keys on the graph background to pan. Filtering narrows filenames/paths. Workspace changes, active drafts, and window focus refresh the graph automatically.

the graph is local and temporary: it writes no index or layouts and performs no network requests. active saved-note edits are included. workspace snapshots support up to 2,000 documents/20 mib; the SVG view shows up to 500 matching nodes at once, with a visible count and filter. drafts without a workspace path are not nodes. reduced-motion preferences skip the initial animation.

layout uses [d3-force](https://d3js.org/d3-force), copyright Mike Bostock and contributors, ISC license. its notice and dependencies appear in hibi's open source licenses.
