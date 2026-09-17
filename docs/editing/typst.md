# typst

enable **typst** in settings → addons. use **new typst document** from the command palette, or open a `.typ` file from the file menu, explorer, or a file drop.

source mode edits typst; split view shows source alongside the typeset preview. the unsupported rich-editor view is disabled. use the pinned **export pdf** action above the preview, or **export typst pdf** in the command palette. syntax errors leave the source editable. formatting tools insert native Typst syntax and share the editor's undo history.

markdown documents can contain rendered blocks:

````markdown
```typst
$ integral_0^1 x dif x = 1/2 $
```
````

use the pencil button to edit a block, or its pdf button to export it. **insert typst block** is available in the palette and slash menu. disabling typst restores ordinary code-fence editing. the latex/math extension still owns markdown's inline `$…$` syntax.

compilation runs locally in a background process. local project imports, images, data, and font files are supported. hidden files and symlinks are excluded; package downloads are disabled. previews are bounded to 10 seconds and 200 pages. pdf export supports up to 64 mib. exported documentation embeds compiled svg previews for offline reading.

see [document formats](../development/document-formats.md) for the extension api, and the extension's readme for credits, cache paths, and input limits.
