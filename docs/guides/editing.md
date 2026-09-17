# editing

## formatting toolbar

the row below the top bar contains undo/redo, bold, italic, strikethrough, inline code, paragraph, headings 1–6, bullet/numbered/task lists, indent/outdent, quote, code block, divider, line break, links, images, and tables. the toolbar has one shared border and background, inset 12 px horizontally and 4 px vertically. individual buttons are flat, with hover and active backgrounds. actions that do not fit move into an ellipsis menu; arrow keys navigate it, escape closes it, and clicking outside dismisses it. formatting follows the last focused pane in split view and restores editor focus after an action. source actions edit selected markdown in a single undo step; rich actions use the editor's own commands. rich-only constructs that cannot be edited safely remain disabled.

link and image buttons open shared dialogs. links preserve selected text; an empty selection inserts the address. images accept absolute paths or paths relative to the saved note, with a description for screen readers. insertion is canceled if the document changes while the dialog is open. in a rich-text table, extra actions add/remove rows and columns or delete the table. in source view, use the table button to insert a markdown table and edit its cells directly.

appearance → toolbar controls icons/text, visibility, and **hide toolbar while typing** (on by default). it uses the top bar’s typing/idle timer: the toolbar fades and collapses while typing, moving the editor up, then smoothly restores its space after 1.2 seconds idle. move the pointer to the top to reveal both immediately. toolbar auto-hide can be disabled independently; reduced motion removes the movement. expand **arrange toolbar actions** to drag rows, use keyboard-accessible up/down buttons, or reset order. dragging toolbar buttons also changes their order. built-in and addon actions share this saved arrangement.

select all stays within the active editor. switching views focuses the visible editor, and clicking a line number selects that source line without selecting gutter text. both cmd+a and ctrl+a select editor content; vim may own ctrl+a in its source modes. line numbers never enter the selected/copied text.

switching files keeps the chosen view and its pane positions, including while the new source editor loads. pane sliding/fading runs only when changing views, so moving between files in split view does not replay a normal-to-split transition.

split panes link vertical scrolling in both directions using their relative scroll positions, accounting for different rendered heights. scroll either pane to move the other; leaving split view removes the link. toolbar drag targets use a straight vertical insertion line between buttons.

when the top bar hides, the first 24 px of the editor fade to transparent, softening partially scrolled lines. the fade uses the same timing as the chrome and leaves the split divider independent; it disappears when the top bar returns.

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

see [media and navigation](../editing/media-and-navigation.md) for drag/drop, attachments, shift-click links, back/forward shortcuts, remote opening, and leaving empty formatted blocks.

click the filename, enter a new name, and press enter. escape or clicking away cancels. names without an extension receive `.md`. renaming an unsaved document sets its suggested save name; existing files are renamed in the same folder without replacing another file. unsaved edits remain pending after a rename.

new, open, save, and save as use native dialogs. hibi checks for unsaved edits before replacing a document, and checks disk changes before overwriting the same file. saves write and sync a temporary file before renaming it over the destination.

source switching preserves original markdown. rich edits may normalize markdown syntax. the [frontmatter addon](frontmatter.md) preserves metadata while allowing visual body edits. raw html, reference definitions, and frontmatter without its enabled addon stay editable in source mode; their rich preview is read-only, without a banner. local images display without rewriting their Markdown references.

documents are UTF-8 and limited to 2 mib. drafts are held in memory; renderer reloads recover them from the main process, but a full process or machine crash can lose unsaved edits.
