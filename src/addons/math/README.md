# LaTeX

optional extension by may. enable **LaTeX** in settings → addons or the command palette. the internal `math` id stays stable so existing preferences and API integrations continue to work.

## LaTeX documents

open `.tex` or choose **New LaTeX document**. source and split views preserve the complete source, with LaTeX highlighting and formatting tools. **Compile document** runs Tectonic after confirmation, including local inputs from a saved document's folder, then displays a real PDF. **Export PDF** saves those compiler bytes. compile/export controls stay pinned above the preview. install Tectonic on PATH; the plugin's settings include **Check tools**. save other included documents before compiling; the active unsaved buffer is used as-is.

the regular, non-executing preview uses Pandoc 3.11 or newer and native math markup. HTML export uses this safe preview; PDF export uses the explicit compilation result. enabling this plugin exposes its format, syntax, highlighting, and settings entries. disabling it keeps source editing available.

## Inline and block math

in Markdown, `$x^2$` renders inline; `$$` delimiters render a block. fenced and inline code remain literal. automatic flavor detection recognizes these expressions; use the flavor pill to override a file's syntax.

click a rendered expression to edit latex in a shared dialog. the toolbar and palette provide inline and block insertion in both rich and source editors. source remains ordinary markdown and latex. invalid expressions show their source rather than interrupting editing.

settings → syntax has separate inline and block math switches. turning either off keeps the latex delimiters visible as literal markdown in the editor and export.

katex and its fonts run locally. exports embed rendered equations, mathml, styles, fonts, and license notices; no cdn or runtime model is required. katex uses `trust: false`, bounded macro expansion, and no shared user macros. full `.tex` documents use the separate native compiler described above.

uses mit-licensed [tiptap mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) and [katex](https://katex.org/docs/security), listed in hibi's open source licenses.

Font embedding preserves each complete `@font-face` rule and the KaTeX math-family declarations in both the editor and offline exports.
