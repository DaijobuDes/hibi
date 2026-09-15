# frontmatter

enabled by default; toggle it in settings → addons.

normal view edits the body of documents with a closed YAML frontmatter block. the addon keeps the metadata, delimiters, line endings, and spacing verbatim when body edits are saved. edit metadata directly in markdown view.

the addon registers a markdown projection through `context.editor.registerMarkdown`. it does not parse YAML values or provide a metadata form. unsupported or unclosed blocks retain the core's source-only editing protection. disabling the addon preserves the document and leaves metadata-bearing files editable in markdown view.
