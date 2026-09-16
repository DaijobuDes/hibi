# workspace explorer

`cmd+/` (`ctrl+/` outside macos) toggles the sidebar. each file and folder has an ellipsis menu, also available through right-click or shift+f10.

actions include rename, duplicate, copy to, move to, copy relative path, and move to trash. folders also offer nested new file/folder actions. destination paths are relative to the workspace and include the resulting file or folder name. existing entries are never replaced. workspace actions reject traversal, reserved names, and symlinks.

new folders are created immediately. new files remain in memory until first save. both enter inline rename immediately; enter applies the name and escape leaves the current name. the rename field stays until confirmed or canceled. unsaved files show a small status dot; changes to the active file survive renaming or moving its parent. first save fails if another file has since appeared at the draft's destination.

copy and duplicate use saved disk content. save an ephemeral file before copying it. trash uses the system trash and asks before moving a folder's contents. deleting an active dirty document preserves the normal save/discard/cancel choice.
