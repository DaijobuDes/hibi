# Open files with Hibi

Hibi accepts local document files from the operating system, including Finder's
Open With menu, Dock drops, and Windows/Linux launch arguments. Requests received
while starting or performing another file operation wait until the editor is
ready. Opening an already-open file selects its tab. Single-file mode keeps its
normal save/discard/cancel prompt.

Unsupported formats and unreadable files show a notice. Opening a file never runs
its embedded code; executable formats retain their explicit Run action.

## Default application

Open **Settings → Formats**. Each enabled bundled format has a **Make default**
action alongside its plugin settings. Plain text and Markdown are always listed.
The choice applies to every extension shown for that format. Disabling an addon
does not undo an OS default; files still open safely as source text.

- **macOS:** move Hibi to Applications. Its bundle advertises supported document
  types in Finder's Open With menu. Make default uses Launch Services and verifies
  the result. You can also select a file in Finder and use **Get Info → Open with
  → Hibi → Change All**.
- **Windows:** install the NSIS release. It registers Hibi as an available editor
  without overwriting existing defaults. **Choose default…** opens Windows Default
  apps, where you select Hibi for the listed extensions. Windows requires this
  user choice; Hibi does not rewrite the protected UserChoice registry keys.
- **Linux:** keep the AppImage at a permanent location. **Make default** registers
  its launcher, icon, and MIME types in your user data directory, then uses
  `xdg-mime` and verifies the result. This requires `xdg-utils`, `shared-mime-info`,
  and `desktop-file-utils`. Desktop environments group defaults by MIME type, so
  aliases such as `.html` and `.htm` share a default. If you move the AppImage,
  repeat the action from its new location. Desktop integration tools can also
  register the AppImage for Open With without making it the default.

Development and preview builds can receive files but do not change OS defaults.
Installer registrations and bundled format manifests share
`src/shared/file-associations.ts`. Third-party addon formats remain openable in
Hibi but are not automatically registered with the operating system.

Platform references: [Electron file-open events](https://www.electronjs.org/docs/latest/api/app#event-open-file-macos),
[Apple's file association settings](https://support.apple.com/guide/mac-help/choose-an-app-to-open-a-file-on-mac-mh35597/mac),
[Windows Default apps](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings),
and [the desktop entry specification](https://specifications.freedesktop.org/desktop-entry-spec/latest/).
