# media and navigation

## files and folders

drop a markdown (`.md`, `.markdown`, or `.txt`) file onto hibi to open it. drop a folder to open it as a workspace. opening another document uses the same save/discard/cancel check as the file menu.

drag sidebar files or folders onto a folder to move them into it. drop onto blank sidebar space to move to the workspace root; dropping on a file targets its parent folder. existing destinations are never overwritten. the move action in each item's menu remains available from the keyboard. moving the active note preserves unsaved edits.

## attachments

the image toolbar action opens the native file picker. it accepts images, animated gifs, and videos. dropping those files onto either editor pane inserts them at the drop position. an untitled note first asks where to save; canceling leaves its content unchanged.

attachments are copied into an `assets` folder beside the note. original files remain untouched. duplicate names receive a numeric suffix. markdown stores relative `![description](assets/file)` references, so moving the note together with its assets keeps them portable. edit the description in source mode to improve its accessible label.

website-style paths such as `![screenshot](/uploads/screenshot.png)` also work: hibi first checks for a real absolute file, then the open workspace's `uploads` and `public/uploads` folders (or those folders beside the note if no workspace is open). this applies to editor previews and documentation export. opening a workspace refreshes missing media automatically. the markdown path stays unchanged. `file://` URLs remain explicit filesystem paths.

supported images: png, jpeg, gif, webp, avif, and svg, up to 8 mib each. supported video containers: mp4, mov, webm, and ogg/theora, up to 512 mib each; playback depends on the codecs supported by electron. normal and split views show video controls and support seeking through a local stream. unknown or missing media shows its description. no remote media downloads happen automatically.

documentation export embeds media for offline use within its existing 20 mib total limit. large videos should be linked or hosted separately. the `tests/fixtures/clip.webm` sample is a generated one-second blue frame, with no third-party content.

## links and history

shift-click a link in normal view, either split pane, or markdown mode to follow it. web and email links open in the default app; markdown links open in hibi. regular clicks keep editing. local heading anchors scroll the rich document.

`cmd/ctrl+[` goes back and `cmd/ctrl+]` goes forward between opened notes, or between settings pages while settings is open. navigation asks about unsaved edits before replacing a note. saved files are read from disk when revisited. history lasts for this app session. `escape` closes settings; when a dialog is open, escape dismisses that dialog first. shifted bracket shortcuts still select the editor view.

## remote markdown

choose **file → open from remote…** in the menu bar and enter a raw http/https markdown url. hibi downloads utf-8 text, opens an editable draft, and suggests a filename for a local save. it never writes back to the server. webpage html, embedded url credentials, non-web protocols, files over 2 mib, and more than five redirects are rejected. requests time out after 20 seconds. relative attachment paths need local assets after saving.

## empty blocks

table-cell line breaks remain editable. to continue after a final table, code block, list, or other formatted block, use `cmd/ctrl+enter`, press down at its final cursor position, or click the blank editor area below it. these actions add a normal paragraph only when requested; merely opening a note does not rewrite it.
