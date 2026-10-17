# Running the development build

Install Git and the Node version in `.nvmrc`, currently Node 24. From a checkout of Hibi, run:

```sh
npm ci
npm run dev
```

The development app uses a separate data profile. Core React and CSS changes update while it runs. Preload changes reload the window and retain drafts. Main-process and native addon changes use the normal close checks before restarting the app; canceling a save prompt keeps the current app and drafts running.

Changes inside an existing `src/addons/<id>/` or local `src/useraddons/<id>/` folder update that addon. CSS and theme files update in place; renderer code and manifest edits restart the addon and its active required consumers while other addons keep their state. An editor affected by a code reload briefly becomes read-only, then restores its selection and focus. A compile error keeps the running addon. An open addon window or visible addon settings page blocks code reload; the development console explains what to close before editing again.

The development command also watches the HTML exporter and generated API documentation. Restart it after adding or removing an addon folder. Changes to addon activation, permissions, requirements, file types, and native or analysis contracts use the guarded app restart. Descriptive manifest changes, such as names and license notices, reload the addon. Native format names also require the app restart. Addon documentation and images imported by the main process use that guarded restart too; files outside both import graphs are ignored. File watching and these targeted updates are development-only; production builds do not register them.

Development format workers load their compiler packages from `node_modules` instead of bundling them into each main-process rebuild. This keeps rebuilds smaller, but starting a format preview or explicit run can take longer in development. Production builds still bundle these compilers; use a production preview when checking their packaged behavior.

Dependency installation applies `scripts/patch-vim.mjs` to CodeMirror Vim. The patch lets imported leader mappings take priority over built-in keys. Review it when updating the Vim engine, and run `tests/vim-config.test.mjs` against the rebuilt app.

## Preview a production build

```sh
npm run build
npm run preview
```

Use this when checking behavior that may differ from development, such as startup time or bundled assets.

## Use a separate profile

Pass Electron arguments after the extra separator:

```sh
npm run dev -- -- --user-data-dir=/path/to/test-profile
```

Use a new profile when testing first launch or default settings. Avoid sharing a profile between running instances.

Development and test launches don't show the first-run introduction automatically. Add `--hibi-introduction` to show it when the profile hasn't seen it yet:

```sh
npm run dev -- -- --user-data-dir=/path/to/test-profile --hibi-introduction
```
