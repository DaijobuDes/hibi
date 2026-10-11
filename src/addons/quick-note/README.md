# Quick note

Quick note captures a Markdown note while Hibi is running, even when another application has focus. Enable the addon in **Settings → Addons**. Its default global shortcut is `Cmd/Ctrl+Alt+N`. You can also choose **Quick note: capture** from the command palette.

In **Settings → Quick note**, choose the current workspace, a recent workspace, or use **Choose workspace…** to select another folder as a workspace. Then select its root or a folder. You can keep the default title, change it, or ask for a title each time. Set a different global shortcut using an Electron accelerator such as `CommandOrControl+Alt+N`, or clear the field to disable it. Press **Save settings** to apply your choices. If another application owns the shortcut, choose a different one; the command palette action remains available.

The shortcut and the command open a small capture window of its own, above other applications and on the display with the pointer. Hibi's main window is not shown or brought forward. Press **Save note** or `Cmd/Ctrl+Enter` to create a new `.md` file in the selected folder; the window confirms the save and closes. Repeated titles receive a number so an existing note is never replaced.

Press `Escape`, `Cmd/Ctrl+W`, or **Close** to close the window without saving. Your unsaved text is kept and restored the next time the window opens. Only one capture window is open at a time, and Hibi remembers its size and position on each display.

The shortcut works only while Hibi is running. On macOS, it keeps working after you close Hibi's last window. Quitting Hibi releases the shortcut.
