# typst

optional bundled extension. enable **typst** in settings → addons.

## documents

open a `.typ` file, or use **new typst document** in the command palette. source view edits typst with syntax highlighting, formatting tools, vim, line numbers, and undo; split view adds a live typeset preview. the unsupported rich-editor view is disabled. previews wait 250 ms after typing, compile in a separate process, and report errors without changing the source. **export typst pdf** remains in the command palette; **export pdf** stays pinned above the preview.

typst files participate in the workspace explorer, rename/move, saving, navigation, and local version history. saving or renaming without a new extension preserves `.typ`. disabling this extension leaves source editing available. markdown formatting shortcuts and slash commands do not modify typst source. dropping images into the source pane inserts `#image(...)` references to copied local assets.

## markdown blocks

use a fenced `typst` block, or **insert typst block** in the palette or slash menu:

````markdown
```typst
$ sum_(k=1)^n k = (n(n+1))/2 $
```
````

normal/split view renders the block. its pencil button opens a source editor; the pdf button exports that block. inline `$…$` in markdown remains the separate latex/math extension's syntax. when typst is disabled, its blocks remain ordinary, editable code fences.

documentation export includes compiled typst documents and blocks as embedded svg images. exported sites need no compiler or network connection. pdf and svg preserve typst's page layout; the preview is not a wysiwyg editor.

## local compilation

the app bundles `@myriaddreamin/typst-ts-node-compiler` 0.7.0; no separate typst executable is required. the compiler runs in an owned utility process. it receives a virtual project containing supported documents, fonts, data, and media from the selected workspace (or the current file's folder). hidden files, symlinks, dependency/build folders, and files outside that root are excluded. local imports resolve relative to the current note.

project limits: 1,000 requested dependency files, 64 mib of input assets, and 64 rounds of dependency discovery. unrelated files are not scanned or counted. each compile has a 10-second timeout; output is capped at 200 pages, 20 mib of svg, and 64 mib of pdf. timed-out workers are terminated and recreated on the next request. the app remains interactive during preview compilation.

automatic package downloads are blocked through a local denying proxy honored by the pinned compiler. this also prevents document-computed package names from becoming network requests. local imports work offline; cached packages can be placed under hibi's application-data `typst/packages` folder using typst's namespace/name/version layout. compiling never uploads your document.

## credits and licenses

- hibi integration: may (`1262793452236570667`).
- [typst](https://github.com/typst/typst): the typst project developers, apache-2.0.
- [typst.ts](https://github.com/Myriad-Dreamin/typst.ts): myriad-dreamin and contributors, apache-2.0.
- bundled fonts and assets retain their [upstream notices](../../../docs/licenses/typst-assets.md), also available in hibi's open source licenses.

settings → syntax can disable typst blocks inside markdown, preserving their fences as editable literal text. this does not disable `.typ` document previews or pdf export. settings → code highlighting independently controls typst source highlighting.

the lightweight source highlighter uses codemirror; the typst compiler validates actual syntax. see [document format api](../../../docs/development/document-formats.md) for the reusable host APIs.
## Input discovery

The compiler loads local dependencies as it requests them. Unrelated workspace files do not count toward the 1,000-file / 64 MiB dependency limit. Inputs remain confined to the note's workspace, and symlinks cannot escape it. Missing inputs and compiler diagnostics appear in the shared preview notice.
