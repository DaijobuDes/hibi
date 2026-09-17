# workspaces

use **open a folder…** in the left sidebar, the folder button, or **open workspace…** in the command palette. a workspace is an ordinary local folder. hibi creates no project format and does not move your files.

the sidebar starts hidden on every launch. the chevron beside its top-bar toggle switches between **workspace** and **in this page**. selecting a view opens it, and typing leaves it open. cmd/ctrl+/ toggles the selected view. **in this page** lists the note's rendered headings; selecting one moves the caret to that heading in the active rich or source editor. headings inside code blocks are excluded.

before a folder is open, the workspace view centers a folder icon above **open a folder**. opening a workspace selects that view and replaces this entry with the file tree and folder controls.

on startup, the untouched empty draft shows **start typing**, up to five recent workspace paths, and **dismiss this**. select a path to reopen that folder. the list is local to this app profile, newest first, and updates when a folder opens from the picker or a drop. typing or dismissing removes the welcome content for the rest of the window session. new notes and opened empty files show only the regular **start typing** placeholder. welcome content never becomes part of the document or its saved markdown.

the tree shows `.md` and `.markdown` files, including nested folders. folder rows expand and collapse. arrow keys move focus; right/left expand or collapse folders; enter opens a file. the highlight slides to the current document and stays visible under the pointer.

opening a folder leaves the current note intact. opening a file selects or creates its tab and preserves other drafts. with **Use tabs** disabled, it replaces the current note after the save/discard/cancel check. saving a new note starts the save dialog in the selected workspace. the tree marks unsaved files across all open tabs, including pending files that have not been saved yet. create nested folders using the native save dialog or your file manager; the tree watches filesystem changes and also has a refresh button.

dotfiles, dotfolders, `node_modules`, and symlinks are excluded. hibi checks canonical paths before reading workspace files. very large folder scans stop at 20,000 entries; choose a smaller documentation folder when that limit is reached.

the sidebar button hides or shows navigation with a short slide from the left. labels retain their width during motion; reduced-motion preferences disable transitions. settings, workspaces, and exported sites use the same sidebar component and keyboard behavior.

with navigation visible, window controls sit over the sidebar and document controls begin beside it. hiding navigation brings the top bar together. settings keeps its category sidebar and hides document-only actions.

the sidebar paints one continuous surface behind the window controls, so its top and body move together when opening and closing.

document content moves with the sidebar in the editor and exported site. it resizes once per toggle, then animates horizontally without rewrapping each frame. narrow exported pages keep the sidebar above the document.

drag the sidebar's right edge to resize it. the desktop app shares the chosen width between workspace and settings; exported sites remember their own width in browser storage. widths range from 152 to 480 pixels, limited by available window space. resizing still works when browser storage is unavailable.

focus the resize edge and use left/right arrows (8 pixels, or 24 with shift), home/end for the limits, and enter to reset. double-click also restores the default width; escape cancels an active drag.
