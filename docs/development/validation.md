# development and validation

Desktop checks run once per pull request and on pushes to `main`. Feature-branch pushes do not start a duplicate matrix.

Packaging uses Bash on every runner so Windows preserves electron-builder's dotted configuration arguments.

Actions uses the shared `.github/actions/ci` action for regular checks and nightlies. It caches npm downloads, Electron/builder downloads, compiled `out` files, TypeScript incremental state, and the revision/test list from successful runs. Cache keys separate OS, architecture, and dependencies; checkpoints also validate Node and runner-image versions. Failed jobs do not publish a passing checkpoint.

`npm run check:ci` compares the previous push or PR base with the checkout, plus changes since the cached successful revision. Static local imports select dependent test files. App changes rerun all desktop tests; tests with filesystem or dynamic dependencies are selected conservatively. Unchanged builds are reused, and package validation is skipped when the app has not changed. Lint and generated-document checks always run. Ordinary `npm run check` still runs the complete local suite.

Missing caches, unavailable history, config changes, or unknown inputs fall back to full checks. The `clean` checkbox under Actions → check/nightly → Run workflow ignores caches, removes generated build/typecheck state, and runs every test. `CI_CLEAN=true npm run check:ci` provides the same full-check override from a shell. The run summary records its base revision, rebuild decision, and test count.

Local incremental runs also include uncommitted edits and untracked files. Dirty checkouts never write a successful revision checkpoint.

use node 24 lts, or node 22.18 or newer. install dependencies with `npm ci`.

```sh
npm start           # app and static exporter template watch mode
npm run preview     # last production build
npm run docs        # refresh generated API references
npm run docs:check  # reject stale references
npm run export:docs # export docs to out/docs/index.html
npm run check       # lint, API docs, typecheck, builds, native tests
npm run bench       # core and default-plugin CPU benchmarks
npm run bench:desktop # built Electron startup and editor flows
npm run bench:startup # detailed local launch report
npm run package     # unpacked local application
```

React and CSS edits update in place. main/preload changes restart the development process; save working notes before changing native code. the dev profile is separate from packaged app data. the exporter template watches its shared UI dependencies, and generated API references update when their source declarations change.

`build/icon.png` is the app artwork. committed `.icns` and `.ico` variants cover macOS and Windows; regenerate them with `npm run icons` on macOS after replacing the PNG. development and preview use an owned, ad-hoc-signed `hibi.app` copy in `node_modules/.cache/hibi-electron`, with the same name and icon as the release. the installed Electron bundle stays unchanged. the cache is refreshed when Electron or the icon changes. packaged builds use the platform icons in `electron-builder.yml`.

platform exports preserve the supplied artwork on a transparent canvas: macOS uses 80% optical occupancy; Windows and Linux use 87.5%. the Dock and window icons use those padded exports too, keeping dev/preview sizing consistent with packaged apps. generation uses Electron's native image converter without showing a window.

Vite can replace its initial navigation when optimizing a newly added dependency. development treats that aborted navigation as a reload, so it does not close the app.

tests use temporary profiles and real Electron windows. file dialogs are controlled against temporary fixtures. validation covers draft preservation, file writes, workspace traversal and nested navigation, local image resolution and offline embedding, frontmatter fields and YAML preservation, addon enable/disable, export sanitization, offline search and deep links, keyboard behavior, reduced motion, and pane geometry.

the settings focus regression deliberately focuses the source editor between settings dismissal and its deferred restoration frame. the newer focus must win, so immediate source input cannot land in the rich pane.

native tests import `electron` from `tests/electron.mjs`. this launcher adds `--hibi-test`, keeping local windows hidden and unfocusable, with background rendering enabled and all web contents muted. on macOS the test app uses accessory activation policy, so it has no Dock icon. normal app launches keep their usual window behavior. screenshots and DOM input still run against real Electron renderers in the background.

GitHub Actions uses its isolated desktop for test windows, keeping Linux compositor frames and native input active. Linux runs under a 1920×1080 Xvfb display and a session bus. desktop export tests set their browser viewport explicitly, and notification positioning checks use the stack boundary rather than platform scrollbar width. tracked text stays LF on Windows through `.gitattributes`. superseded checks are cancelled and each platform job has a 20-minute limit.

The root `/release/` packaging directory is ignored; nested keybeats `release/` sample folders are tracked. Folder moves use Windows' native non-overwriting rename behavior there; on Unix an empty destination is reserved first. Repository-install checks exercise real Git through a captured command runner, without platform-specific executable shims. Native dialog tests hold their mocked dialog open until the busy state is observed.

After document file operations, the explorer rescans the workspace instead of relying on filesystem watcher delivery. This keeps newly saved drafts visible on platforms whose recursive watchers miss changes under renamed folders. Windows source-editor tests use the standard Ctrl+Y redo shortcut.

Recovery checks terminate only their own renderer process on Linux, avoiding Electron's platform-specific crash-dump path; other platforms use `forcefullyCrashRenderer`. They still verify a real renderer loss, the reload response, and recovered editor/draft state.

Repository installation uses an owned empty Git config file on every platform. Git for Windows rejects Node's namespaced null-device path, so config isolation must not depend on that device. Appearance checks await the queued disk write before asserting persistence.

toolbar and tooltip checks exercise all display modes, visibility, scope cleanup, stale handles, keyboard help, existing descriptions, and help inside native dialogs. keybeats tests decode all 150 local recordings with audio output muted, exercise rich/source input, repeats, search exclusion, profile switching, mute, and disabling the addon. command palette tests sample the selection marker mid-transition and check reduced motion.

colorscheme checks cover all bundled token roles, text contrast, retained upstream notices, rejected CSS expressions, native window persistence, editor/undo preservation, system appearance, addon palette fallback/restoration, CSS override precedence, and exported appearance controls down to 320 px. native Windows/Linux caption rendering needs a check on those platforms.

hibi settings checks compare installed license text with the generated catalog, verify the first tab and responsive license dialogs, reject arbitrary license paths, and intercept the sponsor action to verify its fixed URL without opening a browser.

public SDK and sidebar references are generated from their real TypeScript declarations. update prose guides whenever behavior changes. release builds must pass `npm run check`; platform signing and notarization are separate distribution steps.

## performance benchmarks

`bench/core/` contains 18 Vitest benchmarks for core and default-enabled plugins: Markdown lexing/rendering, GitHub alerts, text extras, frontmatter, colorschemes, hotkeys, and UI casing. Seeded fixtures keep inputs repeatable. Optional math, Typst, graph, and tags benchmarks are excluded.

`npm run bench:desktop` uses CodSpeed's Tinybench integration for six native flows: fresh/retained startup through input and recent-workspace readiness, first displayed keystroke, opening the large and code-heavy documents, and the first source-view transition. Build first with `npm run build`. The same fixtures and readiness/interaction helpers power `scripts/benchmark-startup.mjs`; see [performance measurement](performance.md) for scope and timing boundaries.

`.github/workflows/benchmarks.yml` runs CPU simulation for the core suite and walltime for Electron on pull requests, pushes to `main`, and manual dispatch. Authentication uses OpenID Connect; no new secret is needed. Both jobs cache npm downloads, and the desktop job caches Electron. Manual `clean` dispatch bypasses those caches. Native benchmark rounds run serially using only default-enabled plugins in isolated profiles.

Results appear on the [CodSpeed dashboard](https://app.codspeed.io/schmayterling/hibi) and in pull-request reports after a successful workflow run. Walltime runs on GitHub-hosted Ubuntu because CodSpeed's dedicated macro runners require an organization repository. These elapsed-time numbers include hosted-runner noise; compare repeated results on the same runner configuration, not absolute values from a local Mac. The existing three-platform correctness checks remain separate.

## automatic documentation publishing

pushes to `main` that change `docs/**` run `.github/workflows/docs-sync.yml`. it checks generated API references, builds the same self-contained site template used by the app, and exports the documentation folder to `out/docs/index.html`. nested Markdown pages and local images inside `docs/` are included; symlinked pages and images outside that folder are excluded or rejected.

the workflow checks out `hibigarden/docs` on `main`, replaces only `index.html`, and pushes a normal commit named `docs: sync to main (<source short commit id>)`. unchanged HTML creates no commit. destination workflows, license, readme, and domain settings stay intact. runs are serialized; a concurrent destination update rejects the push instead of being overwritten.

authentication uses the source repository's `DOCS_SYNC_TOKEN` Actions secret. create a fine-grained personal access token with `hibigarden` as resource owner, access only to `hibigarden/docs`, and repository **Contents: read and write** permission, then save it in `schmayterling/hibi` under Settings → Secrets and variables → Actions. renew the secret before the token expires; if the organization requires approval, approve it before running the workflow. the destination disables deploy keys, so the workflow does not use SSH credentials.

both checkout actions clean up their credentials after the job; source checkout credentials are not persisted. the destination's existing Pages workflow publishes the resulting commit. never paste the token into source files or logs.
