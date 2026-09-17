# document formats and compiled markdown

api version 1 remains compatible. formats are optional extension contributions. markdown is an always-available bundled format plugin; plain `.txt` is core and never parses markdown. workspace files never become addon modules.

Bundled runtimes load lazily from their data-only manifests. Their `start()` promise must finish registering required editing behavior before resolving. See [startup performance](performance.md) for lightweight flavor discovery, settings boundaries, and background-only activation rules.

## file formats

declare `fileExtensions: ['typ']` on an extension manifest before calling `context.editor.registerDocumentFormat({ id, name, extensions, language, Preview, render?, insertMedia? })`. extensions omit the dot and use lowercase letters/digits. `.txt` is reserved for core. only one enabled format can own an extension. `editing: 'markdown'` opts into the existing rich markdown pipeline; other formats preserve source and supply a read-only preview. `codeLanguage` links source highlighting to a registered language's setting.

**settings → formats** lists enabled format plugins. each row opens its plugin settings or disables it. enable disabled plugins from **addons**. disabled addons contribute no format rows, syntax controls, code languages, or plugin settings pages. markdown and plain text stay available. disabling a format never changes its documents.

document-format syntax controls use `registerDocumentSyntax`; they need no markdown token matcher and use the existing `isSyntaxEnabled` / `onSyntaxChange` API. ordinary markdown features retain their required token matchers. `resolveCodeLanguage` and `renderCode` reuse enabled languages and the app's escaped highlighting output; `onCodeHighlightingChange` keeps previews current.

the host uses these declarations in file pickers, rename/move checks, dropped files, workspace scanning, and source fallback. `language` is a codemirror `Language`. `Preview` receives `{ value, document }`; it renders the normal/split preview and must never rewrite the source merely by rendering. source editing and common source addons remain available when the format is disabled. markdown formatting controls are hidden for other document formats.

`insertMedia(attachments)` optionally returns source syntax for copied media, where each attachment contains `{ url, alt }`. `render(source, documentId?)` asynchronously returns `{ html, css }` for documentation export. the exported site sanitizes that html. disposal removes the format; it does not delete files or saved content.

## views, formatting, and preview actions

`views` declares supported editor modes: `normal` means editable rich content, `side-by-side` means source with preview, and `markdown` is the historical id for source-only mode. source must remain available. Markdown supports all three; plain text supports only source. other bundled formats support source and split view. unsupported buttons are disabled, palette actions are omitted, and shortcuts cannot select those modes. a disabled format falls back to source.

`formatting: 'markdown'` reuses Markdown's source toolbar and shortcuts. other formats supply `DocumentFormatting`: supported action ids, a pure `apply(action, selection)` function, and optional `isActive`. the host applies the returned `DocumentEdit` as one validated undo step, preserving source selections. common ids include `bold`, `italic`, `strike`, `heading-1` through `heading-6`, `paragraph`, `bullet-list`, `numbered-list`, `checklist`, `quote`, `inline-code`, `code-block`, `link`, `image`, `divider`, `hard-break`, and `table`. list only actions the format implements. undo, redo, indent, and outdent remain host-owned.

`Preview` receives a `toolbar` target. render shared `PreviewActions` into that target for compile, run, and export buttons. the host owns its sticky row, spacing, and scrolling behavior. the component keeps its own state; no second toolbar state store or document mutation is needed.

`context.editor.getDocument()` reads the active document snapshot. `onDocumentChange(listener)` immediately reports the current document when available, then reports edits and switches. listeners are owned by the extension lifecycle. `DocumentState.markdown` retains its historical API name and contains the original source for every format.

## async exports

`context.editor.renderDocument(source, filename, documentId?)` selects a registered document renderer or the markdown pipeline. markdown flavors can provide `export.transform(rendered, source, documentId?)`, which runs after synchronous markdown rendering and may compile embedded content. the older `renderMarkdown` API stays synchronous and unchanged.

set `MarkdownFlavor.readOnlyWhenDisabled: false` only when disabling that syntax leaves a lossless built-in representation, such as a fenced code block. the default keeps unknown syntax protected against destructive rich edits.

## trusted native modules

native addons can use `context.document.get()`, `context.document.path(id?)`, and `context.document.create(name, source)`. paths resolve only to the active note or an opaque document id in the selected workspace. these paths are never given to markdown content or renderer-only sideloaded extensions. creation uses existing unsaved-change checks.

`context.exportFile(bytes, suggestedName, extension)` opens a native save dialog and writes atomically, up to 64 mib. it refuses to replace the currently open source document. native addons validate their own renderer input before compiling or exporting. optional `NativeAddon.stop()` releases workers and other resources when disabled.

heavy compilers belong in owned background processes, with cancellation, bounded output, and scoped inputs. typst supplies one implementation in `src/addons/typst/`; it does not add typst-specific parsing to the core editor.

the bundled text formats share `src/addons/_shared/`: format metadata comes from their data-only manifests, parser jobs run in disposable utility processes, and source toolbar mappings share the host's selection and undo path. do not copy these services into individual plugins. see the [format guide](../editing/formats.md) for dependencies and execution limits.

see the generated [addon api](../reference/addon-api.md).
