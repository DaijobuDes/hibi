# Document formats

Enable format plugins in **Settings → Addons**. Enabled formats appear in **Formats**, **Syntax**, **Code highlighting**, and their plugin settings pages. Click a format's Settings button to configure it. Markdown and plain text are always available.

| Format | Extensions | Preview and export |
| --- | --- | --- |
| Markdown | `.md`, `.markdown` | Rich editing, source, split view, HTML |
| Plain text | `.txt` | Core source editor; no Markdown parsing |
| MDX | `.mdx` | Inert preview; explicit React server render; HTML |
| LaTeX | `.tex` | Math-aware HTML preview; explicit Tectonic PDF compilation |
| reStructuredText | `.rst` | Native Pandoc preview and HTML |
| AsciiDoc | `.adoc`, `.asciidoc` | Native Pandoc preview and HTML |
| Org mode | `.org` | Native Pandoc preview and HTML |
| Typst | `.typ` | Bundled compiler, live typeset preview, PDF |
| HTML | `.html`, `.htm` | Sanitized static preview and HTML |
| MediaWiki | `.wiki`, `.mediawiki` | Native Pandoc preview and HTML |
| R Markdown | `.rmd` | Inert preview; explicit R/rmarkdown render; HTML |
| Quarto Markdown | `.qmd` | Inert preview; explicit Quarto render; HTML |
| MDsveX | `.svx` | Inert preview; explicit Svelte server render; HTML |
| Markdoc | `.mdoc` | Bundled Markdoc parser and HTML |
| Djot | `.dj` | Native Pandoc preview and HTML |
| Textile | `.textile` | Native Pandoc preview and HTML |
| Creole | `.creole` | Native Pandoc preview and HTML |

## Views and tools

Plain text has source view only. Formats without a rich editor offer source and split view; their normal-view button is disabled. Switching files selects an available view automatically. Disabling a format leaves its source editable.

Toolbar buttons write the selected format's syntax. Markdown variants reuse Markdown tools; other formats map headings, emphasis, lists, links, images, code, and tables to their native notation. Unsupported tools are hidden. Source selection and undo work through the same editor path. LaTeX link, image, and strikethrough actions add missing `hyperref`, `graphicx`, or `ulem` packages after a conventional `\documentclass` declaration. Included snippets without a preamble rely on their parent document's packages.

Compile, run, and export actions stay pinned at the top of the preview panel. Editing keeps the current preview visible while its replacement renders, preserving the scroll position. Source code and HTML previews use the app's shared highlighting settings. Previews preserve document text and never convert the saved file to Markdown.

## Native tools

Pandoc **3.11 or newer** supplies the native text readers, including AsciiDoc. LaTeX PDF compilation needs **Tectonic**. R Markdown execution needs **R**, the **rmarkdown** package, and its rendering dependencies. Quarto execution needs **Quarto** and the document's selected R/Jupyter runtime. Install these separately and put them on PATH; plugin settings include **Check tools**. Common macOS package-manager locations are also recognized.

Typst, Markdoc, MDX, MDsveX, HTML parsing, PDF viewing, and inline KaTeX rendering are bundled. MDX and Svelte runs can import local components and installed project packages. These are server renders: browser-only APIs and client interactivity are unavailable in the editor preview.

## Explicit execution

Typing previews keep embedded JavaScript, R, and Python inert. **Run document** explicitly runs the selected document and its project code after confirmation. Execution has the user's file and network access. Results correspond to that source snapshot; editing requires another run. Run results can be exported as sanitized HTML.

**Compile document** runs LaTeX through Tectonic with shell escape disabled. Saved documents resolve local includes and assets from their folder. Tectonic may download required packages. The resulting PDF is shown locally and exported unchanged. Inline math inside Markdown still uses offline KaTeX.

Regular Pandoc previews use its restricted `--sandbox` reader. Includes that require file access and executable/custom project features are not followed automatically. HTML previews remove scripts, forms, and document styles and use Hibi's typography. Markdown-site export uses this safe preview path; it never silently executes a project.

## Limits

Parser jobs accept up to 2 MiB of source, run for up to 15 seconds, and return up to 20 MiB of HTML. Explicit runs have a 90-second limit. PDF files are capped at 64 MiB, previews at 200 pages, and individual rendered pages at 16 million pixels. Local images are limited to 8 MiB each and 20 MiB when embedded together. Errors keep source editing available and use the shared preview notice.

Typst resolves dependencies on demand, so unrelated workspace files do not exhaust its input limit. Its compiler-specific limits remain documented in the [Typst guide](typst.md).
