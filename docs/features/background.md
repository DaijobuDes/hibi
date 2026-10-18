# Running in the background

Enable **Keep Hibi running in the background** under **Settings → About → General** if you want global shortcuts and enabled addons to keep working after you close the main window. It is off by default on every platform.

When enabled, closing hides the main window and keeps its unsaved edits in memory. The icon stays in the macOS menu bar, the Windows taskbar notification area, or the Linux tray where your desktop supports it. Choose **Open Hibi** to restore the same window. Launching Hibi again also restores it.

Choose **New quick note** to run the Quick note addon's capture command. This item appears only while that addon is enabled and its command is available. You must configure the addon before saving a note. **Settings** opens Hibi's app settings.

Use **Quit** from the icon's menu or the app menu when you want Hibi to stop. You can press `Cmd+Q` on macOS or `Ctrl+Q` on Linux. On Windows, background mode also enables `Ctrl+Q`; it is unavailable while background mode is off. Hibi asks you to save or discard unsaved changes before quitting. Cancelling returns to your document. You can also quit before Hibi finishes starting. Closing a window is not a save operation, so save your work regularly or enable [autosave](../guides/settings.md#autosave).

On Linux, some desktops need an AppIndicator or StatusNotifier extension to display tray icons. Use your desktop's app launcher to reopen Hibi if no icon is visible. Background mode keeps the editor and addons in memory, and enabled addons can still use resources. It does not hide the macOS Dock icon or start Hibi at login.
