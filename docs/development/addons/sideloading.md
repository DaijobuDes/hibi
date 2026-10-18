# Sideloading and sharing

Sideloading installs an addon without rebuilding Hibi. An extension package needs `hibi-addon.json`, `README.md`, and a compiled browser module.

## Make a package

Create a folder with this `hibi-addon.json`:

```json
{
  "id": "hello",
  "name": "Hello",
  "description": "A greeting from your first addon.",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "extension",
  "authors": [{ "displayName": "Your name" }],
  "entry": "index.js"
}
```

Add an `index.js` that exports a factory. Hibi passes its [shared SDK](../addon-api-reference/SideloadFactory.md) to this factory.

```javascript
export default () => ({
  start(context) {
    context.commands.register({
      id: 'greet',
      label: 'Say hello',
      run: () => context.notify('Hello from your addon.'),
    })
  },
})
```

Add a readme that explains how to use the command. This example is already JavaScript and needs no build step. For TypeScript or JSX, compile your package before sharing it. Hibi does not run package installation or build scripts.

For TypeScript checking, Hibi's local `@hibi/addon-sdk` tarball supplies addon contracts without runtime code. Run `npm run sdk:pack` in a Hibi source checkout, install the resulting `.tgz` in your addon development project, and use `import type` from `@hibi/addon-sdk/api`, `@hibi/addon-sdk/sdk-loader`, or `@hibi/addon-sdk/sdk`. Use `CapabilityFactory` for a package declaring `capabilities`, or `SideloadFactory` for a legacy package. Set `apiVersion` to `2` for new packages. Strict type checking requires the package's React, CodeMirror, Tiptap, and Marked peers; use Hibi's shared SDK values in installed code.

Use the factory's `React`, `ui`, `tiptap`, `codeMirror`, and `markdown` values instead of bundling second copies of those libraries. Relative imports may load other compiled files in your package. Do not import from Hibi's source tree in an installed package.

## Load only the SDK you need

New packages can declare `capabilities` in the manifest. Use `ui` for React and shared controls, `rich` for Tiptap, `source` for CodeMirror, and `markdown` for Marked. An empty array supplies only the lightweight `documents` helpers. Packages that omit this field retain the legacy SDK with all engines.

```json
{
  "capabilities": [],
  "activation": "command",
  "commands": [{ "id": "greet", "label": "Say hello" }]
}
```

Add these fields to the greeting package above to keep its runtime unloaded until the command is invoked. The command descriptor is plain metadata; its ID must match the runtime registration. A source-only integration can use `activation: 'source'`, while `rich` activation runs in visual or split view. Omit activation for document formats and syntax that must exist before editing.

Declaring capabilities also stages editor configuration, commands, toolbar items, and sidebar views until `start()` finishes. Registrations are published in stable ID order and removed if startup fails. Document syntax cannot use command or view activation, and background packages cannot install required editor integrations. These SDK choices control loading; renderer packages still run trusted code.

## Install it locally

Run **Install addon…** from the command palette and choose a package folder or a folder containing several packages. Hibi searches nested folders for `hibi-addon.json`. A single candidate uses the usual confirmation. Several candidates open a review list with every detected package, including invalid or blocked ones and their reasons.

All installable packages start selected. Review their folders, versions, sources, permissions, network origins, required providers, and any replacement details. Use `Tab` to move between controls and `Space` to toggle a checkbox, then choose **Install selected**. Required providers must already be installed or remain selected. Unchecking a missing provider makes its consumers unavailable and shows a reason; other selected packages can still install. Selecting the provider again makes those consumers available. Selected providers install before their consumers.

Each selected package installs independently. The review list shows success or failure for each row; one failure does not undo other successful installations. Keep the review open to select remaining packages or retry failed rows without downloading the source again. **Cancel** during installation stops pending work, while completed installations remain. Closing the dialog or pressing `Escape` also cancels pending work. New packages stay disabled until you enable them in **Settings → Addons**. A replacement keeps its current setting unless it asks for different access, as described in [update a package](#update-a-package). If you already have a source addon with the same ID, use a different ID for this package.

Installed extensions run trusted code with access to documents through the addon APIs. Install packages only from sources you trust. Native handlers, importers, and addon windows must ship with Hibi; installed manifests cannot declare these privileges or replace a built-in addon ID.

Keep `hibi-addon.json` within 64 KiB, including full license notices. Each top-level `licenses[].text` notice can use up to 64 KiB of UTF-8 text, subject to that total manifest limit. Inline color scheme notices retain their 32,000-character limit. API versions 1 and 2 use the same package format and validation.

Packages installed before Hibi accepted stylesheets and theme files keep ignoring those fields and native/importer/window declarations without granting privileges. Reinstall such a package to use its stylesheets and themes.

## Signatures and unsigned packages

New installs and replacements require a valid Hibi signature by default. Ask Hibi's maintainers to review your source and compiled package for signing. Sign the finished package before publishing it, and keep the signature beside `hibi-addon.json`. Rebuilding, editing the readme, or adding or removing a package file requires a new signature. See [maintainer signing instructions](signing.md).

For packages you trust that have not been signed, turn on **Allow unsigned addons** in **Settings → Addon Manager → Security**, then install again. This permits unsigned packages, including replacements. It never permits a broken signature or a revoked version. Existing unsigned installations keep working when this setting is off. Built-in addons and the source development watcher do not need package signatures.

A signature identifies the signing key and confirms the package's contents. Installed extensions still run trusted code with access to documents through the addon APIs. Signing does not isolate an addon or grant it native privileges.

### Signature file format

`hibi-addon.sig.json` is a JSON envelope with three string fields:

```json
{
  "keyId": "1b43eadedb48d51d",
  "statement": "<base64 of signed UTF-8 JSON bytes>",
  "signature": "<base64 Ed25519 signature>"
}
```

The decoded package statement has this shape:

```json
{
  "type": "hibi-addon-signature",
  "version": 1,
  "id": "hello",
  "addonVersion": "1.0.0",
  "files": {
    "README.md": "<lowercase SHA-256 hex>",
    "hibi-addon.json": "<lowercase SHA-256 hex>",
    "index.js": "<lowercase SHA-256 hex>"
  },
  "signedAt": "2026-10-18T00:00:00.000Z"
}
```

The signature covers the exact decoded statement bytes, without reformatting JSON. Paths use `/` and are relative to the package root. The file map must exactly match every file that Hibi installs, except the root signature file itself and the excluded paths described below. Unknown signing keys, malformed statements, manifest ID or version mismatches, missing files, added files, and different hashes block installation.

## Revoked addons

Hibi checks `https://www.hibi.garden/addons/revocations.json` shortly after startup and at most once every 24 hours while running. The request sends no cookies or credentials. **Check for revoked addons** controls these network checks. An accepted list stays in the local profile and applies offline, including when network checks are off.

A revoked installed addon is disabled through the usual runtime cleanup, and its required consumers stop as well. Its reason appears in the installed addon list. Revoked versions cannot be installed or enabled. A list can name particular versions or revoke every version of an addon. Install a signed replacement that is not revoked to recover. If a later list removes a revocation, the addon stays disabled until you enable it.

Revocation lists use the same signed envelope as packages. Their decoded statement has this shape:

```json
{
  "type": "hibi-addon-revocations",
  "version": 1,
  "sequence": 2,
  "issuedAt": "2026-10-18T00:00:00.000Z",
  "entries": [
    { "id": "hello", "versions": ["1.0.0"], "reason": "A security issue was found." }
  ]
}
```

Omit `versions` to revoke every version. Each published change needs a higher sequence number. Older lists and different contents with an already accepted sequence are ignored. Failed downloads, HTTP errors, invalid signatures, and lists larger than 256 KiB retain the last accepted list without a notification.

## Add stylesheets and themes

An extension can list up to 16 CSS files in `styles` and up to 20 color schemes in `themes`. Paths are relative to the package folder.

```json
{
  "styles": ["styles/base.css", "styles/panels.css"]
}
```

A theme entry is either an inline color scheme or the path of a JSON file that contains one, such as `"themes": ["themes/evening.json"]`.

Declared themes register before your extension's `start()` runs. Each theme ID must be unique across the manifest and `context.colorschemes.register()`. Registering a declared ID again fails startup and removes that activation's themes and stylesheets. Choose a different ID for a runtime theme; registration does not replace an existing theme.

Hibi checks these files when you install the package. Each one must be a regular file inside the package, and each theme file must be valid JSON no larger than 64 KiB that describes one color scheme. Stylesheets follow the usual package file limits.

Stylesheets and themes load when the extension starts and are removed when it stops, is disabled, or fails to start. Stylesheets apply only after the extension has started successfully. If one cannot be loaded within five seconds, the extension stops with an error. A disabled extension loads none of its files. Their themes are available in **Settings → Appearance** while the extension runs. If the selected theme's extension is disabled, Hibi uses the default theme until the extension is enabled again, and your selection is kept.

Package stylesheets apply after Hibi's own styles and selected theme, in addon ID order and then in the order listed. Styles registered with `context.styles` come after them, and override-priority styles, such as custom CSS from **UI preview**, still come last. Specificity, cascade layers, and `!important` continue to decide the final result.

Relative `url()` and `@import` references resolve from the stylesheet's own location, so fonts and images can live in the package. Remote stylesheets, fonts, and images are blocked. Prefix your selectors with a class unique to your addon unless you intend to restyle Hibi itself; stylesheets are not isolated from the rest of the app.

## Share it

Publish the prepared files in a public HTTPS Git repository or ZIP archive. Hibi searches recursively, so each package can live in its own nested folder. Users can install that URL through **Settings → Addons → Install from URL** and review several packages together.

Git packages need their compiled entry committed on the default branch, and Git installed on the user's machine. Private repositories, SSH URLs, and submodules are not supported. Do not include `node_modules`, secrets, or native executables.

## Discovery and package limits

Repository discovery allows at most 5,000 entries, 64 MiB of uncompressed data, 5 MiB per file, and 64 manifests. A manifest may sit at the root or beneath at most 12 directory segments. ZIP downloads retain a 25 MiB compressed transfer limit. Exceeding a discovery limit rejects the input rather than showing an incomplete list.

Each selected package retains its own limits: 1,000 entries, 25 MiB total, and 5 MiB per file. Its readme and declared compiled entry must be inside its folder. Parent or sibling libraries are not copied automatically.

Discovery excludes hidden directories, `.git`, `node_modules`, and `__MACOSX`, regardless of case. Ignored ZIP entries still count toward archive limits. Parent directory aliases are resolved before scanning. The selected folder and its contents cannot be links or junctions. Special files, unsafe paths, and conflicting archive paths are refused.

Structurally valid packages with duplicate IDs are all blocked. A valid package containing another valid package also blocks both roots; publish them in separate folders. An invalid outer manifest remains visible but does not hide a valid prepared package beneath it. Built-in and source addon IDs cannot be replaced. An installed external ID is a reviewed replacement, with its old and new versions and sources shown before installation.

## Update a package

Increase the version and install the replacement. If its kind, SDK capabilities, network origins, and external tools are unchanged, it keeps its enabled setting. A running addon then restarts with the new files, together with the addons that require it. Open documents and unsaved edits stay as they are. While the settings of one of these addons are on screen, or one of them has a window open, Hibi refuses the replacement so their unsaved input is not lost; close them and install again. During installation their settings stay closed, and editing pauses briefly while an addon the document uses restarts. If any of those fields change, the replacement stays disabled until the user reviews and enables it.

A restart runs your code from the beginning. Values in memory, React state, and session storage start fresh, while global and workspace storage remain. Make `stop()` remove everything `start()` created so the new copy finds no leftovers.
