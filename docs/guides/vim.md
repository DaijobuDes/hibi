# vim editing

enable **vim** under settings → addons. it adds vim editing to markdown-only mode and the source pane of split view. normal view keeps its visual editor controls.

the plugin uses the [CodeMirror vim engine](https://github.com/replit/codemirror-vim), loaded only when enabled. normal, insert, replace, visual, linewise visual, and blockwise visual modes include motions, counts, text objects, operators, registers, marks, macros, dot-repeat, undo/redo, search, and ex substitutions. standard examples include `ciw`, `d3w`, `"ayy`, `qa…q`, `@a`, `/word`, and `:%s/old/new/g`.

on macOS, hibi uses key repeat instead of the press-and-hold accent picker so held vim motions keep moving. this setting is scoped to hibi and does not change other apps; enter accented characters with the standard option-key combinations.

## file commands

- `:w` saves through hibi's normal save flow; an untitled note opens the save dialog.
- `:e` opens the file picker; `:e relative/path.md` opens a file in the current workspace.
- `:enew` creates a new note, checking unsaved edits first.
- `:q` closes the window using hibi's unsaved-edit checks.
- `:wq` and `:x` save, then close only if saving succeeds.

this is an embedded vim editing engine. it does not run vimscript, terminal commands, external vim plugins, or shell escapes. force-quit flags do not bypass hibi's unsaved-edit checks. `:w filename` is not supported; use save as to choose a new path. app shortcuts such as cmd+k keep their normal behavior.

## preferences

settings → plugins → vim controls starting in insert mode and showing the current mode in a bottom-left status pill. command prompts stay inside the source pane and remain available when status is hidden. preferences persist; the starting mode applies to new source editor sessions. disabling the plugin removes its key handling and status pill while preserving the document and source undo history.

the status bar sits below the editor page, beside the sidebar. its second pill builds the pending command as you type (`2` → `22` → `22k`) and keeps the completed sequence visible until the next one begins. `22k` runs when you press `k`; pressing enter afterward leaves the pill showing `22k`. escape cancels a pending command and restores the previous display. search (`/`, `?`) and `:` prompts are included. text typed in insert mode is not shown. **show vim status** hides or shows both pills.
