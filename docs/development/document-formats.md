# document formats and compiled markdown

api version 1 remains compatible. formats are optional extension contributions; markdown remains built in. workspace files never become addon modules.

## file formats

declare `fileExtensions: ['typ']` on an extension manifest before calling `context.editor.registerDocumentFormat({ id, name, extensions, language, Preview, render?, insertMedia? })`. extensions omit the dot and use lowercase letters/digits. built-in markdown extensions cannot be replaced. only one enabled format can own an extension.

the host uses these declarations in file pickers, rename/move checks, dropped files, workspace scanning, and source fallback. `language` is a codemirror `Language`. `Preview` receives `{ value, document }`; it renders the normal/split preview and must never rewrite the source merely by rendering. source editing and common source addons remain available when the format is disabled. markdown formatting controls are hidden for other document formats.

`insertMedia(attachments)` optionally returns source syntax for copied media, where each attachment contains `{ url, alt }`. `render(source, documentId?)` asynchronously returns `{ html, css }` for documentation export. the exported site sanitizes that html. disposal removes the format; it does not delete files or saved content.

`context.editor.getDocument()` reads the active document snapshot. `onDocumentChange(listener)` immediately reports the current document when available, then reports edits and switches. listeners are owned by the extension lifecycle. `DocumentState.markdown` retains its historical API name and contains the original source for every format.

## async exports

`context.editor.renderDocument(source, filename, documentId?)` selects a registered document renderer or the markdown pipeline. markdown flavors can provide `export.transform(rendered, source, documentId?)`, which runs after synchronous markdown rendering and may compile embedded content. the older `renderMarkdown` API stays synchronous and unchanged.

set `MarkdownFlavor.readOnlyWhenDisabled: false` only when disabling that syntax leaves a lossless built-in representation, such as a fenced code block. the default keeps unknown syntax protected against destructive rich edits.

## trusted native modules

native addons can use `context.document.get()`, `context.document.path(id?)`, and `context.document.create(name, source)`. paths resolve only to the active note or an opaque document id in the selected workspace. these paths are never given to markdown content or renderer-only sideloaded extensions. creation uses existing unsaved-change checks.

`context.exportFile(bytes, suggestedName, extension)` opens a native save dialog and writes atomically, up to 64 mib. it refuses to replace the currently open source document. native addons validate their own renderer input before compiling or exporting. optional `NativeAddon.stop()` releases workers and other resources when disabled.

heavy compilers belong in owned background processes, with cancellation, bounded output, and scoped inputs. typst supplies one implementation in `src/addons/typst/`; it does not add typst-specific parsing to the core editor.

see the generated [addon api](../reference/addon-api.md).
