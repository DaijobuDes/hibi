# exporting documentation

the sidebar starts directly with the file tree; the top bar contains the workspace breadcrumbs and sidebar toggle.

## navigation and small screens

breadcrumbs live in the top bar, with links back to the workspace and parent folders. previous and next page links sit below the document, separated by a divider, and follow sidebar order.

the navigation toggle stays in the sidebar's top area when open. breadcrumbs sit outside the sidebar over the document, matching the app's split header. collapsing or resizing navigation moves that header boundary with it. phone drawers hide the underlying breadcrumbs while open.

headings appear in an **in this page** outline on the right when there is room. on smaller screens the outline becomes a disclosure above the document; choosing a heading closes it and scrolls to that section. the current section is highlighted while scrolling.

on phones, workspace navigation opens over the document with a dismissible backdrop. choosing a page, tapping outside, or pressing escape closes it. entering the phone layout also closes an open sidebar. header breadcrumbs shorten, content padding decreases, tables and code scroll within their own area, and the rest of the page keeps its width.

phone navigation rows and header controls use 44px touch targets. the shared sidebar selection follows the same row-height token, so its sliding highlight stays aligned at both densities.

## export a folder

1. keep documentation in markdown files inside a folder. nested folders are supported.
2. open that folder as a workspace.
3. enable **documentation** in settings → addons.
4. choose **export documentation** in the command palette.
5. save the generated `.html` file.

upload that file to any static host, usually as `index.html`. it also opens directly from disk. no server, account, build step, search service, or network request is needed to read it.

## included

local image, gif, and video attachments are embedded for offline viewing. videos show standard playback controls. exports retain the 20 mib total limit for markdown and embedded media; see [attachments](../editing/media-and-navigation.md#attachments).

- normal read-only markdown rendering; no editor or source-view controls.
- the shared full-height nested sidebar, with a smooth slide from the left.
- `cmd/ctrl+k` search with fuzzy matching, prefix matches, and keyword relevance. titles and paths receive extra weight. this is local text search, not an embedding model.
- hash-based document and heading links, browser history, nine [colorschemes](colorschemes.md), bundled geist fonts, and reduced-motion support.

the palette button in the top bar opens appearance settings. exports carry the author's system/light/dark mode and selected built-in palettes. a visitor's saved choice takes precedence. addon palettes fall back to hibi; addon code and CSS are not exported. full third-party palette license notices are included in the HTML and appearance settings.

relative links between included markdown pages are rewritten for the exported site. `README.md` or `index.md` at the root is the initial page when present. the current document’s in-memory edits are included if it belongs to the workspace; exporting does not silently save those edits back to the original file.

exports support up to 2,000 documents and 20 mib of markdown and embedded images. the export contains every included markdown file and its local Markdown images, so review the selected folder before publishing. hidden documents, symlinked documents, and `node_modules` are excluded.

## boundaries

raw html is sanitized. scripts, forms, event handlers, and dangerous URLs are removed. a restrictive content security policy blocks network requests and unapproved scripts.

local Markdown images are embedded in the HTML, including relative paths, absolute paths, and local `file:` URLs. each image must be PNG, JPEG, GIF, WebP, AVIF, or SVG and no larger than 8 mib. relative paths resolve from each note's folder. missing or unsupported images retain their alt text. remote images are not fetched. links to non-markdown files are disabled unless they are explicit external web/mail links.
