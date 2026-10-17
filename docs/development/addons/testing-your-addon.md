# Testing your addon

Start with a disposable workspace. Check the addon in each view it supports, then disable and enable it. Its commands, toolbar items, styles, and listeners should disappear and return without duplicates.

For editor features, test undo, redo, unsaved changes, and a document containing syntax the addon does not recognize. For previews, check empty input, errors, and large documents. Test keyboard access and both light and dark appearance for new controls.

## Run repository checks

For an addon being contributed to Hibi, run:

```sh
npm run check
```

This runs lint, documentation checks, type checking, builds, and the test suite. To work on one test after building, run it directly:

```sh
npm run build
node --test tests/addon-settings.test.mjs
```

Use `tests/electron.mjs` for Electron tests. Give each test a temporary profile and workspace, and close the app before deleting them. See [testing changes](../core/testing-changes.md).

## Test the package

Install the compiled package in a separate profile, then run its features, disable it, replace it, and remove it. This catches missing assets and imports that work in the source tree but not in an installed package. Replace it while it is enabled, too: it should restart with the new files and leave no duplicate commands, styles, or listeners behind.

Click your addon’s row in **Settings → Addons** to check its readme. Its relative images and documentation links should stay within the package.
