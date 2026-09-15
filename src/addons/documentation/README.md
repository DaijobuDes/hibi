# documentation addon

the first hibi addon turns a folder of markdown into one deployable HTML document.

enable **documentation** under settings → addons. open a workspace, then choose **export documentation** from the sidebar or command palette. a native save dialog selects the destination. the exported site provides nested navigation, normal read-only rendering, and local fuzzy/keyword search on `cmd/ctrl+k`.

`index.ts` registers the export command through the renderer SDK. `native.ts` snapshots the selected workspace, embeds escaped data into the generated site template, and uses the host’s native save operation. `manifest.ts` declares API compatibility and defaults.

the viewer uses the shared sidebar and command palette, DOMPurify, MiniSearch, and locally bundled Geist. external/relative attachments are not copied; embedded raster images are supported. exports include in-memory edits to the current workspace document and do not save them back to disk.

see [exporting](../../../docs/guides/exporting.md) and [addon development](../../../docs/development/addons.md).
