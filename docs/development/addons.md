# creating addons

hibi uses source-defined addons, similar to vencord’s plugin structure. addons are compiled with the app and enabled in settings. they are trusted application code, not sandboxed packages discovered in a document workspace.

## layout

put bundled addons in `src/addons/<id>/`, or private addons in the git-ignored `src/useraddons/<id>/`:

```text
manifest.ts   metadata and api version
index.ts     renderer entry point
native.ts    optional native methods
README.md    addon documentation
```

vite discovers these folders. add files and rebuild, or use `npm start` while developing. a renderer addon uses browser APIs; filesystem work belongs in its native entry point.

## renderer entry

```typescript
import { defineAddon } from '../api'
import manifest from './manifest'

export default defineAddon({
  manifest,
  start(context) {
    context.commands.register({
      id: 'hello',
      label: 'hello from my addon',
      run: () => context.notify('hello'),
    })
  },
  stop() {
    // Clean up any subscriptions or resources created by start.
  },
})
```

private addons import the SDK from `../../addons/api`. use a unique lowercase id containing letters, numbers, or hyphens. commands receive an automatic `<addon-id>.` prefix. the host unregisters commands when an addon stops; addons must clean up their own event listeners and timers in `stop`.

`context.workspace` opens or reads the selected workspace. `context.native.invoke` can call only that addon’s exported native methods. errors are shown in the app. native methods receive input as `unknown` and must validate their own arguments.

## native entry

export a `NativeAddon` with an id and a map of asynchronous methods. `context.workspace.snapshot()` returns markdown pages with relative paths. `context.exportHtml()` asks the user where to save and writes the HTML there. never register a generic filesystem or arbitrary IPC dispatcher.

see [the documentation addon](../../src/addons/documentation/README.md) for the working example and [the generated API reference](../reference/addon-api.md) for exact signatures.

## shared navigation

import `Sidebar` from the UI SDK at `src/addons/ui.ts`. it supports nested tree navigation or a flat tab list, optional headers/footers, keyboard focus, and a sliding selected background. hibi settings, the workspace picker, and exported documentation use this same implementation.

## compatibility

the public API is version 1. manifests declare `apiVersion`; incompatible manifests are rejected. preserve existing signatures when adding capabilities. breaking changes require an API version bump, addon migration, and documentation updates.

run `npm run docs` after changing public types. `npm run docs:check`, included in `npm run check`, fails if generated references differ from the actual SDK or shared types. keep your addon’s README updated with behavior changes.
