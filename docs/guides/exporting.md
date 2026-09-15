# exporting documentation

1. keep documentation in markdown files inside a folder. nested folders are supported.
2. open that folder as a workspace.
3. enable **documentation** in settings → addons.
4. choose **export documentation** below the file tree or in the command palette.
5. save the generated `.html` file.

upload that file to any static host, usually as `index.html`. it also opens directly from disk. no server, account, build step, search service, or network request is needed to read it.

## included

- normal read-only markdown rendering; no editor or source-view controls.
- the shared full-height nested sidebar, with a smooth slide from the left.
- `cmd/ctrl+k` search with fuzzy matching, prefix matches, and keyword relevance. titles and paths receive extra weight. this is local text search, not an embedding model.
- hash-based document and heading links, browser history, light/dark themes, bundled geist fonts, and reduced-motion support.

relative links between included markdown pages are rewritten for the exported site. `README.md` or `index.md` at the root is the initial page when present. the current document’s in-memory edits are included if it belongs to the workspace; exporting does not silently save those edits back to the original file.

exports support up to 2,000 documents and 20 mib of markdown and embedded images. the export contains every included markdown file and its local Markdown images, so review the selected folder before publishing. hidden documents, symlinked documents, and `node_modules` are excluded.

## boundaries

raw html is sanitized. scripts, forms, event handlers, and dangerous URLs are removed. a restrictive content security policy blocks network requests and unapproved scripts.

local Markdown images are embedded in the HTML, including relative paths, absolute paths, and local `file:` URLs. each image must be PNG, JPEG, GIF, WebP, AVIF, or SVG and no larger than 8 mib. relative paths resolve from each note's folder. missing or unsupported images retain their alt text. remote images are not fetched. links to non-markdown files are disabled unless they are explicit external web/mail links.
