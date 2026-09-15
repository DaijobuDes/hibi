# editing

start typing in a blank document. normal view is the rich-text editor; side-by-side puts markdown on the left and rich text on the right; markdown-only edits the original source. the title bar provides file and view controls. its center opens the command palette, with draggable space around the filename.

panes slide at fixed text widths. a pane that shrinks reflows once at the end. the markdown engine prepares during idle time and waits for its font and layout before appearing. reduced-motion preferences disable animations.

## finding text

`cmd/ctrl+f` opens find in note. enter advances; shift+enter goes back; escape closes. search is literal and case-insensitive. in side-by-side it searches the last focused pane, including offscreen markdown. the input width animates as the match count changes.

## commands and settings

`cmd/ctrl+k` opens the command palette. search, use arrow keys, and press enter. drag its non-interactive chrome to move the window; inputs and command rows remain interactive.

settings contains editor, appearance, hotkeys, addons, and about. padding defaults to 48 px and can be changed from 0–96 px. the top bar can fade while typing. hotkeys can be rebound, cleared, or reset; conflicts and standard editing/window shortcuts are rejected. all command hints use the active bindings.

## saving

new, open, save, and save as use native dialogs. hibi checks for unsaved edits before replacing a document, and checks disk changes before overwriting the same file. saves write and sync a temporary file before renaming it over the destination.

source switching preserves original markdown. rich edits may normalize markdown syntax. raw html, frontmatter, and reference definitions stay editable in source mode; rich mode becomes read-only for those constructs. images are preserved as references but external/local images are not loaded by the editor.

documents are UTF-8 and limited to 2 mib. drafts are held in memory; renderer reloads recover them from the main process, but a full process or machine crash can lose unsaved edits.
