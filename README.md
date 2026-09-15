# hibi

minimal markdown editor built on electron 44.3.0, react, strict typescript, and electron-vite. starts with an empty, focused editor and a `start typing` placeholder. normal resizable window, integrated title area, native window controls.

## editing

- **normal:** wysiwyg editing with markdown shortcuts. use `format` for bold, italic, headings, lists, quotes, and code.
- **side-by-side:** editable rich text and syntax-highlighted markdown, synchronized in both directions.
- **markdown only:** edit the original source directly.

the compact title bar holds file actions, filename, formatting, and view controls. editor panels fill the space below it. settings has a full-height sidebar with a flat category list: editor, appearance, and about. editor-only controls disappear on settings. adjust padding from 0–96 px (default 48 px), or change whether the top bar hides while typing. preferences persist across launches. use escape or the back button to return to your unchanged document.

click the centered filename, press `cmd/ctrl+shift+p`, or press `f1` for the command palette. search file operations, view modes, settings, and top-bar behavior. use arrow keys and enter to run a command, or escape to dismiss. opening and closing settings, changing categories and views, and opening and dismissing the palette use short transitions; reduced-motion preferences disable them.

`cmd/ctrl+f` opens find in note at the top right. matching is literal and case-insensitive; enter/shift+enter or the arrow buttons navigate matches. escape closes it. search uses rich text in normal view, source text in markdown view, and the last focused pane in side-by-side view. search includes the full document, including markdown outside the visible viewport.

geist sans and geist mono come directly from [vercel's geist package](https://github.com/vercel/geist-font) and load from bundled woff2 files. no google fonts or font cdn requests. the font license ships in `resources/licenses/geist.txt`.

startup and lazy editor loading show a centered, faded page icon with a shimmer. reduced-motion mode shows a static icon. lucide supplies interface icons; simple-icons is installed for future brand icons and is not bundled unless used.

the flat title bar keeps its filename centered on the window. it fades out while typing and returns after 1.2 seconds idle, when the pointer moves into the top 36 px, or when its controls receive keyboard focus. its space stays reserved so text does not jump.

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
- `src/renderer/`: tiptap rich editor, lazily loaded codemirror source editor, react, and css. bundled geist fonts and system light/dark mode; no node access.
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
