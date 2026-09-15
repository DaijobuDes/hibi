# workspaces

use **open a folder…** in the left sidebar, the folder button, or **open workspace…** in the command palette. a workspace is an ordinary local folder. hibi creates no project format and does not move your files.

the tree shows `.md` and `.markdown` files, including nested folders. folder rows expand and collapse. arrow keys move focus; right/left expand or collapse folders; enter opens a file. the highlighted file is the current document.

opening a folder leaves the current note intact. opening a file checks unsaved changes first. saving a new note starts the save dialog in the selected workspace. create nested folders using the native save dialog or your file manager; the tree watches filesystem changes and also has a refresh button.

dotfiles, dotfolders, `node_modules`, and symlinks are excluded. hibi checks canonical paths before reading workspace files. very large folder scans stop at 20,000 entries; choose a smaller documentation folder when that limit is reached.

the sidebar button hides or shows navigation. settings, workspaces, and exported sites use the same sidebar component and keyboard behavior.
