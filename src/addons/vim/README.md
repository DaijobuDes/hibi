# vim

editor CSS is registered through `context.styles` and removed when this addon stops.

version 0.1.0 · may (`1262793452236570667`). disabled by default.

adds the CodeMirror vim engine to source panes through `context.editor.registerSource`. the engine is imported on demand and includes mode-aware cursors, visual selections, motions, operators, registers, macros, search, and ex commands. the normal wysiwyg view keeps its existing input behavior.

native file commands use `context.editor.runCommand` and `context.workspace.openFile`, preserving dialogs, unsaved edits, and external-change checks. `:w`, `:e`, `:enew`, `:q`, `:wq`, and `:x` integrate with hibi. force-quit flags still check unsaved edits. shell execution, vimscript, external vim plugins, and `:w filename` are outside this embedded engine.

the optional settings page controls the initial insert mode and status visibility. `context.statusBar.register` supplies a bottom-left mode pill; command prompts remain in the source pane. view-scoped command contexts, status handles, and preference listeners are cleaned up when the editor or plugin stops. see [the editing guide](../../../docs/guides/vim.md) and [upstream engine](https://github.com/replit/codemirror-vim).
