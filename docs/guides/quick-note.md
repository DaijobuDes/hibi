# Capture a quick note

Enable **Quick note** in **Settings → Addons**. Press `Cmd/Ctrl+Alt+N` from any application, or choose **Quick note: capture** from the command palette. A capture window opens on the display with the pointer, above your other windows. Hibi's main window stays where it is, even when it is hidden, minimized, or on another desktop. On macOS, the capture window also appears over full-screen apps and on every Space.

Choose a destination in **Settings → Quick note**. Use the current workspace, select a recent workspace, or use **Choose workspace…** to select another folder as a workspace. Then choose its root or a folder. You can change the global shortcut with an Electron accelerator such as `CommandOrControl+Alt+N`; clear it to use only the command palette. Save the settings to apply them.

The capture window is a small Hibi editor with the formatting toolbar and the same Markdown features as your documents. The bar at the bottom shows the destination as the workspace and folder; hover over it to see the full location. Press **Save** or `Cmd/Ctrl+Enter` to create a Markdown file. The window confirms the file name and closes.

The note's first heading becomes its file name. Without a heading, Hibi uses the default title from the settings. Turn on **Ask for a title** to start each note with the default title as its heading, ready to change. Hibi adds a number when a file with the same name already exists, so existing notes are never overwritten. When the destination is the current workspace, the note goes to the workspace that was open when the capture window opened.

Press `Escape`, `Cmd/Ctrl+W`, or **Cancel** to close the window without saving. Hibi keeps your unsaved note, also across restarts, and shows it the next time you open the capture window. To discard it, delete the text before closing. Pressing the shortcut while the window is open brings the same window forward. Hibi remembers the window's size and position separately for each display.

After you use it, the capture window stays ready in the background for ten minutes, so it opens instantly. After that, Hibi releases its memory and the next capture takes a moment longer to open.

The capture window uses your Hibi appearance, colorscheme, and editor preferences. Colorschemes from installed theme packages appear in the main window only; the capture window uses the built-in colorscheme for that appearance. You cannot attach images in the capture window, and links do not open from it.

The shortcut works only while Hibi is running. On macOS, it keeps working after you close Hibi's last window, and the capture window opens without reopening the main window. Quitting Hibi releases the shortcut. On Linux, some desktop environments, including most Wayland sessions, do not let applications place or focus windows, so the capture window may open in a different position or wait for you to select it.
