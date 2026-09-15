# hibi

minimal markdown editor built on electron 44.3.0, react, strict typescript, and electron-vite. starts with an empty, focused editor and a `start typing` placeholder. normal resizable window, integrated title area, native window controls.

## editing

- **normal:** wysiwyg editing with markdown shortcuts. use `format` for bold, italic, headings, lists, quotes, and code.
- **side-by-side:** editable rich text and syntax-highlighted markdown, synchronized in both directions.
- **markdown only:** edit the original source directly.

the compact title bar holds file actions, filename, formatting, and view controls. editor panels fill the space below it. open editor settings (sliders icon) to adjust padding from 0–48 px; default is 8 px and the preference persists across launches.

native file menu supports new (`cmd/ctrl+n`), open (`cmd/ctrl+o`), save (`cmd/ctrl+s`), and save as (`cmd/ctrl+shift+s`). opening another document, starting a new one, closing, or quitting asks before discarding unsaved changes. a dot beside the filename marks unsaved changes.

switching views preserves the exact markdown source. rich edits serialize markdown and may normalize spacing or syntax. html, frontmatter, reference definitions, and footnotes stay editable in source mode; rich mode becomes read-only for those documents to prevent lossy conversion. headings, emphasis, links, code, quotes, lists, task lists, and tables are supported. image references are preserved, but external and document-relative images are not loaded yet.

## run

use node 24 lts (`nvm use`); node 22.18 or newer also works.

```sh
npm ci
npm run dev
```

`dev` refreshes react in place and restarts electron when main or preload code changes. development binds to loopback only and uses its own `hibi-dev` profile.

```sh
npm run check    # lint, typecheck, build, and real electron smoke tests
npm run package  # unpacked application in release/
npm run dist     # platform installer; never publishes
npm start        # launch the last production build
```

on headless linux, run `xvfb-run --auto-servernum npm test`. tests keep sandboxing enabled and use a temporary profile. macos, windows, and linux checks are configured in `.github/workflows/check.yml`; hosted runs require a github repository.

## boundaries

- `src/main/`: window lifecycle, native menus, permission policy, local asset protocol, and privileged ipc handlers.
- `src/preload/`: sandbox-compatible commonjs bridge. exposes individual typed operations; never exposes `ipcRenderer`, filesystem access, or a generic channel dispatcher.
- `src/shared/`: contracts shared by main, preload, and renderer.
- `src/renderer/`: tiptap rich editor, lazily loaded codemirror source editor, react, and css. system fonts and light/dark mode; no node access.
- `tests/`: asset traversal and sender checks, plus actual window launch, sandbox, csp, ipc rejection, navigation blocking, offline reload, crash recovery, and macos reopen checks. theme screenshots land in `test-results/`.

production loads bundled content through `app://hibi/`, with a strict script content security policy. inline styles are allowed for editor layout. new windows, page navigation, downloads, and permissions are denied by default. ipc checks window identity, frame identity, and exact document url. file paths come from native dialogs, never renderer-provided paths. react render failures offer reload; renderer crashes offer reload or quit and retain the draft in the main process.

files use utf-8 with a 2 mib limit. saves write and sync a temporary file, then rename it over the destination. existing file permissions are preserved, and changed/deleted files prompt before replacement. drafts live in memory until saved; a full app/process or machine crash is not covered by renderer-crash recovery.

## keep it fast

main handles coordination; put cpu-heavy processing in an electron utility process or worker when needed. use async io. keep renderer imports small and lazy-load substantial screens. avoid background polling and synchronous ipc. react is bundled at build time, so all dependencies are development dependencies and the packaged app contains only its compiled code.

electron is pinned exactly; the lockfile makes installs repeatable. dependabot proposes upgrades weekly. vite 7 is intentional: electron-vite 5 declares support through vite 7. upgrade them together when upstream supports the next major.

## before distribution

`package` produces a local test build, with an ad-hoc macos signature so hardened electron binaries launch locally. configure a final app id, app icon, macos distribution signing/notarization, and windows signing before public distribution. packaging enables asar integrity checks and disables run-as-node, node environment options, and node inspector arguments.

tiptap's markdown extension is marked beta upstream; versions are pinned and common markdown/gfm round trips have runnable checks. accounts, cloud sync, and an update feed are not configured. native fullscreen remains available from the view menu; startup neither maximizes nor enters fullscreen.

references: [electron releases](https://releases.electronjs.org/), [electron security](https://www.electronjs.org/docs/latest/tutorial/security), [electron performance](https://www.electronjs.org/docs/latest/tutorial/performance), [electron-vite](https://electron-vite.org/guide/).
