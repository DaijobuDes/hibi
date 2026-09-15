# workspaces

use **open a folder…** in the left sidebar, the folder button, or **open workspace…** in the command palette. a workspace is an ordinary local folder. hibi creates no project format and does not move your files.

the tree shows `.md` and `.markdown` files, including nested folders. folder rows expand and collapse. arrow keys move focus; right/left expand or collapse folders; enter opens a file. the highlighted file is the current document.

opening a folder leaves the current note intact. opening a file checks unsaved changes first. saving a new note starts the save dialog in the selected workspace. create nested folders using the native save dialog or your file manager; the tree watches filesystem changes and also has a refresh button.

dotfiles, dotfolders, `node_modules`, and symlinks are excluded. hibi checks canonical paths before reading workspace files. very large folder scans stop at 20,000 entries; choose a smaller documentation folder when that limit is reached.

the sidebar button hides or shows navigation with a short slide from the left. labels retain their width during motion; reduced-motion preferences disable transitions. settings, workspaces, and exported sites use the same sidebar component and keyboard behavior.

with navigation visible, window controls sit over the sidebar and document controls begin beside it. hiding navigation brings the top bar together. settings keeps its category sidebar and hides document-only actions.

the sidebar paints one continuous surface behind the window controls, so its top and body move together when opening and closing.

document content moves with the sidebar in the editor and exported site. it resizes once per toggle, then animates horizontally without rewrapping each frame. narrow exported pages keep the sidebar above the document.
