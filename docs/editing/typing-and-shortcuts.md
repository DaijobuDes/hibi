# typing and shortcuts

`cmd+/` toggles the workspace sidebar (`ctrl+/` on windows/linux). rebind it in settings → hotkeys.

markdown and split source panes share toolbar formatting actions and undo history:

| shortcut (cmd on mac, ctrl elsewhere) | action |
| --- | --- |
| mod+b / mod+i / mod+e | bold / italic / inline code |
| mod+shift+x | strikethrough |
| mod+alt+0 / mod+alt+1–6 | paragraph / heading |
| mod+shift+7 / 8 / 9 | numbered list / bullet list / task list |
| mod+shift+b | quote |
| mod+alt+c | code block |

`cmd+k` remains the command palette. explicit app hotkey bindings take precedence; vim handles its own keymap first.

the optional typing speed extension shows estimated wpm/cpm for the current typing session. rates reset after five seconds without typing; the first second uses a one-second floor. extension authors can observe committed typing using `context.editor.onInput(listener)`. events contain a character count and editor view only, excluding pasted text, deletion, shortcuts, and programmatic changes. listeners are removed when the extension stops.

split view shows a faint secondary caret in the inactive pane. it follows corresponding visible markdown text without moving focus, altering either selection, or adding undo steps. nonempty selections, metadata, and offscreen positions hide the marker. markup and custom atoms map to their nearest visible text boundary.
