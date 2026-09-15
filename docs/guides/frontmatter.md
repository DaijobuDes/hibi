# frontmatter

frontmatter is a bundled addon, enabled by default under settings → addons. it recognizes a YAML block at the beginning of a document, opened with `---` and closed with `---` or `...`.

normal view edits the document body. metadata, delimiters, line endings, and spacing are preserved verbatim when body edits are serialized. markdown view contains the whole file and is where metadata is edited.

disabling the addon preserves the file and restores source-only editing for metadata-bearing documents. unclosed metadata and unsupported body syntax remain protected from lossy visual edits. there is no compatibility banner.

this addon provides desktop editing support, not a YAML validator or metadata form. static documentation exports retain the original markdown; metadata values are not used as search or navigation configuration.
