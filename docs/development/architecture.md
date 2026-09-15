# architecture and security

- `src/main`: native window lifecycle, guarded IPC, document IO, workspace access, and native addon hosting.
- `src/preload`: a narrow typed bridge. it exposes no generic IPC, filesystem, or node APIs.
- `src/renderer`: editor state and views, settings, command palette, and renderer addon hosting.
- `src/ui`: shared controls, shortcut keycaps, design tokens, and sidebar used by settings, workspace navigation, and the exported site.
- `src/addons`: versioned SDK and bundled addons. private addons live in `src/useraddons`.
- `src/site`: read-only static documentation viewer; it does not use the Electron bridge.
- `scripts`: site-template builds and generated documentation checks.

the main process checks sender identity, main-frame identity, and the exact app URL for every privileged operation. file dialogs grant paths; workspace calls accept only relative markdown paths inside the selected canonical folder. native addon calls require an enabled addon and an explicitly registered method.

local image requests are bound to the current document revision. main resolves relative references from its native path, bounds reads to 8 mib, and checks image content before returning an image data URL. the bridge cannot return arbitrary file contents. documentation snapshots embed the same validated images.

document replacement, exports, and addon preference writes share an operation guard. closing the app waits for the active operation and confirms unsaved edits. the workspace watcher is debounced and uses asynchronous IO.

the renderer is sandboxed and isolated, with no node integration. app assets use a traversal-checked local protocol. external navigation, child windows, downloads, and permissions are denied. development connects only to its local Vite server.

static exports embed their data as escaped JSON, sanitize rendered markdown with DOMPurify, and permit only a hashed application script. bundled fonts and CSS need no external service. addon code is trusted at build time; a workspace never causes JavaScript to be loaded as an addon.
