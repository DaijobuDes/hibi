# Quarto Markdown

Enable **Quarto Markdown** in **Settings → Addons** to open `.qmd` documents with source highlighting, preview, and HTML export. Source files stay editable when disabled. Once enabled, its row in **Formats** opens this plugin's settings and native-tool check.

Syntax controls and source highlighting share the app's **Syntax** and **Code highlighting** settings. Rendering never rewrites the original source.

Embedded code remains inert while typing. **Run document** explicitly runs this document and its project code with your file and network access; rerun after changes. The result can be exported as HTML. Native preview uses Pandoc 3.11 or newer on PATH. Execution additionally needs Quarto and the runtime selected by the document (for example R or Jupyter).

See [document formats](../../../docs/development/document-formats.md) for shared runtime behavior and limits.

Source and split views are available. The unsupported rich-editor view is disabled. Shared formatting tools write this format's syntax; preview actions remain pinned while the document scrolls.
