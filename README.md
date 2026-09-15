# hibi

lean electron desktop foundation. electron 44.3.0, react, strict typescript, and electron-vite. starts in a normal resizable window with content extending into the title bar; native window controls stay available.

## run

use node 24 lts (`nvm use`); node 22.12 or newer also works.

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
- `src/renderer/`: react and css. system fonts and system light/dark mode; no node access.
- `tests/`: asset traversal and sender checks, plus actual window launch, sandbox, csp, ipc rejection, navigation blocking, offline reload, crash recovery, and macos reopen checks. theme screenshots land in `test-results/`.

production loads bundled content through `app://hibi/`, with a strict content security policy. new windows, page navigation, downloads, and permissions are denied by default. ipc checks window identity, frame identity, and exact document url. react render failures offer reload; renderer process crashes offer reload or quit.

## keep it fast

main handles coordination; put cpu-heavy processing in an electron utility process or worker when needed. use async io. keep renderer imports small and lazy-load substantial screens. avoid background polling and synchronous ipc. react is bundled at build time, so all dependencies are development dependencies and the packaged app contains only its compiled code.

electron is pinned exactly; the lockfile makes installs repeatable. dependabot proposes upgrades weekly. vite 7 is intentional: electron-vite 5 declares support through vite 7. upgrade them together when upstream supports the next major.

## before distribution

`package` produces a local test build, with an ad-hoc macos signature so hardened electron binaries launch locally. configure a final app id, app icon, macos distribution signing/notarization, and windows signing before public distribution. packaging enables asar integrity checks and disables run-as-node, node environment options, and node inspector arguments.

product workflows, persistence, accounts, and an update feed are not chosen yet. add those when their requirements are known. native fullscreen remains available from the view menu; startup neither maximizes nor enters fullscreen.

references: [electron releases](https://releases.electronjs.org/), [electron security](https://www.electronjs.org/docs/latest/tutorial/security), [electron performance](https://www.electronjs.org/docs/latest/tutorial/performance), [electron-vite](https://electron-vite.org/guide/).
