# editing

typing closes the workspace sidebar when no folder is open. an open workspace keeps its navigation visible. use the sidebar toggle to reopen the empty sidebar whenever needed.

## images

normal and split views resolve relative image paths from the saved note's folder. absolute paths and local `file:` URLs also work. spaces can be percent encoded or enclosed in Markdown angle brackets. the stored Markdown keeps the original path.

local PNG, JPEG, GIF, WebP, AVIF, and SVG images are supported up to 8 mib each. save a new note before using relative paths. unavailable images retain their alt text and a path hint. remote images are not fetched. SVGs display as images, never as executable document markup.

documentation exports embed local Markdown images into the HTML, so they remain visible offline. the export limit is 20 mib including embedded image data.

## frontmatter properties

the frontmatter addon adds collapsible metadata fields to normal and split views. edit text, numbers, and booleans directly; add or remove properties from the same panel. use **yaml** for lists, objects, and other YAML structures, then **apply yaml**. invalid YAML cannot overwrite the note. the body stays unchanged when properties change.

use **add frontmatter** in the command palette for a note without metadata. disable the addon under settings → addons to return to editing metadata in markdown only. see the [addon guide](frontmatter.md) for preservation details.

success and error notifications appear at the bottom right without moving your document. use the close button to dismiss them.

start typing in a blank document. normal view is the rich-text editor; side-by-side puts markdown on the left and rich text on the right; markdown-only edits the original source. click the filename to rename it. the separate command-palette control shows its current shortcut, with draggable space between controls.

view switches use a quick text fade: content fades out, reflows once while hidden, then fades back in as the panes slide. the divider fades independently as split view opens or closes. the markdown engine prepares during idle time and waits for its font and layout before appearing. reduced-motion preferences disable animations.

default view shortcuts are `cmd/ctrl+shift+[` for normal, `cmd/ctrl+shift+]` for markdown, and `cmd/ctrl+|` (`cmd/ctrl+shift+\`) for side-by-side. these can be rebound in settings. existing unshifted bracket defaults migrate once when the new shortcuts are free; custom bindings remain intact.

## finding text

`cmd/ctrl+f` opens find in note directly below the top bar, aligned with the editor page's right edge. enter advances; shift+enter goes back; escape closes. search is literal and case-insensitive. in side-by-side it searches the last focused pane, including offscreen markdown. the input width animates as the match count changes.

## commands and settings

`cmd/ctrl+k` opens the command palette. search, use arrow keys, and press enter. drag its non-interactive chrome to move the window; inputs and command rows remain interactive.

click outside the palette or press escape to dismiss it. shortcut hints use the same keycaps throughout the app and exported documentation.

settings starts with hibi, followed by editor, appearance, hotkeys, and addons. the hibi page contains app details, sponsorship, and open source license dialogs. padding defaults to 48 px and can be changed from 0–96 px. the top bar can fade while typing. hotkeys can be rebound, cleared, or reset; conflicts and standard editing/window shortcuts are rejected. all command hints use the active bindings.

settings → editor → **show line numbers** toggles the markdown gutter in markdown-only and side-by-side views. it is hidden by default, saves on this device, and changes without resetting the document or undo history.

appearance also controls the text cursor in both editors: line, outline block, filled block, or underline; fast, normal, or slow blinking; and smooth or blink animation. smooth slides between insertion positions and fades softly. blink moves immediately and switches on/off. cursor preferences persist locally. reduced motion disables sliding and blinking; native caret behavior is retained during composition or when custom geometry is unavailable.

## saving

click the filename, enter a new name, and press enter. escape or clicking away cancels. names without an extension receive `.md`. renaming an unsaved document sets its suggested save name; existing files are renamed in the same folder without replacing another file. unsaved edits remain pending after a rename.

new, open, save, and save as use native dialogs. hibi checks for unsaved edits before replacing a document, and checks disk changes before overwriting the same file. saves write and sync a temporary file before renaming it over the destination.

source switching preserves original markdown. rich edits may normalize markdown syntax. the [frontmatter addon](frontmatter.md) preserves metadata while allowing visual body edits. raw html, reference definitions, and frontmatter without its enabled addon stay editable in source mode; their rich preview is read-only, without a banner. local images display without rewriting their Markdown references.

documents are UTF-8 and limited to 2 mib. drafts are held in memory; renderer reloads recover them from the main process, but a full process or machine crash can lose unsaved edits.
