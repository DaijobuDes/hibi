# development and validation

use node 24 lts, or node 22.18 or newer. install dependencies with `npm ci`.

```sh
npm start           # app and static exporter template watch mode
npm run preview     # last production build
npm run docs        # refresh generated API references
npm run docs:check  # reject stale references
npm run check       # lint, API docs, typecheck, builds, native tests
npm run package     # unpacked local application
```

React and CSS edits update in place. main/preload changes restart the development process; save working notes before changing native code. the dev profile is separate from packaged app data. the exporter template watches its shared UI dependencies, and generated API references update when their source declarations change.

Vite can replace its initial navigation when optimizing a newly added dependency. development treats that aborted navigation as a reload, so it does not close the app.

tests use temporary profiles and real Electron windows. file dialogs are controlled against temporary fixtures. validation covers draft preservation, file writes, workspace traversal and nested navigation, local image resolution and offline embedding, frontmatter fields and YAML preservation, addon enable/disable, export sanitization, offline search and deep links, keyboard behavior, reduced motion, and pane geometry.

native tests import `electron` from `tests/electron.mjs`. this launcher adds `--hibi-test`, keeping windows hidden and unfocusable, with background rendering enabled. on macOS the test app uses accessory activation policy, so it has no Dock icon. normal app launches keep their usual window behavior. screenshots and DOM input still run against real Electron renderers in the background.

colorscheme checks cover all bundled token roles, text contrast, retained upstream notices, rejected CSS expressions, native window persistence, editor/undo preservation, system appearance, addon palette fallback/restoration, CSS override precedence, and exported appearance controls down to 320 px. native Windows/Linux caption rendering needs a check on those platforms.

hibi settings checks compare installed license text with the generated catalog, verify the first tab and responsive license dialogs, reject arbitrary license paths, and intercept the sponsor action to verify its fixed URL without opening a browser.

public SDK and sidebar references are generated from their real TypeScript declarations. update prose guides whenever behavior changes. release builds must pass `npm run check`; platform signing and notarization are separate distribution steps.
