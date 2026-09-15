# editing

success and error notifications appear at the bottom right without moving your document. use the close button to dismiss them.

start typing in a blank document. normal view is the rich-text editor; side-by-side puts markdown on the left and rich text on the right; markdown-only edits the original source. click the filename to rename it. the separate command-palette control shows its current shortcut, with draggable space between controls.

view switches use a quick text fade: content fades out, reflows once while hidden, then fades back in as the panes slide. the divider does not fade. the markdown engine prepares during idle time and waits for its font and layout before appearing. reduced-motion preferences disable animations.

default view shortcuts are `cmd/ctrl+[` for normal, `cmd/ctrl+]` for markdown, and `cmd/ctrl+|` (`cmd/ctrl+shift+\`) for side-by-side. these can be rebound in settings.

## finding text

`cmd/ctrl+f` opens find in note. enter advances; shift+enter goes back; escape closes. search is literal and case-insensitive. in side-by-side it searches the last focused pane, including offscreen markdown. the input width animates as the match count changes.

## commands and settings

`cmd/ctrl+k` opens the command palette. search, use arrow keys, and press enter. drag its non-interactive chrome to move the window; inputs and command rows remain interactive.

settings contains editor, appearance, hotkeys, addons, and about. padding defaults to 48 px and can be changed from 0–96 px. the top bar can fade while typing. hotkeys can be rebound, cleared, or reset; conflicts and standard editing/window shortcuts are rejected. all command hints use the active bindings.

appearance also controls the text cursor in both editors: line, outline block, filled block, or underline; fast, normal, or slow blinking; and smooth or blink animation. smooth slides between insertion positions and fades softly. blink moves immediately and switches on/off. cursor preferences persist locally. reduced motion disables sliding and blinking; native caret behavior is retained during composition or when custom geometry is unavailable.

## saving

click the filename, enter a new name, and press enter. escape or clicking away cancels. names without an extension receive `.md`. renaming an unsaved document sets its suggested save name; existing files are renamed in the same folder without replacing another file. unsaved edits remain pending after a rename.

new, open, save, and save as use native dialogs. hibi checks for unsaved edits before replacing a document, and checks disk changes before overwriting the same file. saves write and sync a temporary file before renaming it over the destination.

source switching preserves original markdown. rich edits may normalize markdown syntax. the [frontmatter addon](frontmatter.md) preserves metadata while allowing visual body edits. raw html, reference definitions, and frontmatter without its enabled addon stay editable in source mode; their rich preview is read-only, without a banner. images are preserved as references but external/local images are not loaded by the editor.

documents are UTF-8 and limited to 2 mib. drafts are held in memory; renderer reloads recover them from the main process, but a full process or machine crash can lose unsaved edits.
