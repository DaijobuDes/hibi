# Running the development build

Install Git and the Node version in `.nvmrc`, currently Node 24. From a checkout of Hibi, run:

```sh
npm ci
npm run dev
```

The development app uses a separate data profile. React and CSS changes update while it runs. Changes to addon runtimes or preload code reload the window and retain drafts. Main-process changes restart the app, so save your work before editing those files.

The development command also watches the HTML exporter and generated API documentation. Restart it after adding a new addon folder.

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
