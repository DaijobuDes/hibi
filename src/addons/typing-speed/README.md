# typing speed

optional extension by may. enable in settings → addons.

two status pills show words/minute and characters/minute over the rolling last 60 seconds. words use the standard five-character convention, including spaces and line breaks. the first minute uses the same 60-second window; results are not extrapolated from a few keystrokes.

counts committed editor typing, including ime input. paste, deletions, vim commands, shortcuts, search, and settings do not count. disabling the extension removes listeners, timer, and pills.

uses `context.editor.onInput` and `context.statusBar.register`. no note content is retained by the counter.
