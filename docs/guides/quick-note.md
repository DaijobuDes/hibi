# Capture a quick note

Enable **Quick note** in **Settings → Addons**. Press `Cmd/Ctrl+Alt+N` from any application, or choose **Quick note: capture** from the command palette. A small capture window opens on the display with the pointer, above your other windows. Hibi's main window stays where it is, even when it is hidden, minimized, or on another desktop. On macOS, the capture window also appears over full-screen apps and on every Space.

Choose a destination in **Settings → Quick note**. Use the current workspace, select a recent workspace, or use **Choose workspace…** to select another folder as a workspace. Then choose its root or a folder. Set a default title, or turn on **Ask for a title** to enter one each time. You can change the global shortcut with an Electron accelerator such as `CommandOrControl+Alt+N`; clear it to use only the command palette. Save the settings to apply them.

Type your note in the capture window. The window shows where the note will be saved. Press **Save note** or `Cmd/Ctrl+Enter` to create a Markdown file; the window confirms the file name and closes. Hibi adds a number when a file with the same title already exists. Existing notes are never overwritten. When the destination is the current workspace, the note goes to the workspace that was open when the capture window opened.

Press `Escape`, `Cmd/Ctrl+W`, or **Close** to close the window without saving. Hibi keeps the unsaved text and restores it the next time you open the capture window. To discard it, delete the text before closing. Pressing the shortcut while the window is open brings the same window forward. Hibi remembers the window's size and position separately for each display.

The capture window uses your Hibi light, dark, and colorscheme choices. Colorschemes added by other addons appear in the main window only; the capture window falls back to the built-in colorscheme for that appearance.

The shortcut works only while Hibi is running. On macOS, it keeps working after you close Hibi's last window, and the capture window opens without reopening the main window. Quitting Hibi releases the shortcut. On Linux, some desktop environments, including most Wayland sessions, do not let applications place or focus windows, so the capture window may open in a different position or wait for you to select it.
