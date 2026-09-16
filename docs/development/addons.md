# creating addons

## colorschemes

`context.colorschemes.register(scheme)` adds a palette to appearance settings and returns a disposer. the host prefixes its local id with the addon id (`my-addon.midnight`). registrations are removed when the addon stops, including failed startup and hot reload. disabling a selected palette falls back to hibi without erasing the preference; enabling it restores that selection.

```ts
context.colorschemes.register({
  id: 'midnight',
  name: 'midnight',
  appearance: 'dark',
  author: 'your name',
  license: { name: 'your license', text: 'full license notice' },
  colors: {
    background: '#181818', surface: '#222222', ink: '#eeeeee',
    muted: '#aaaaaa', accent: '#81cdd1', border: '#353535',
  },
})
```

the six base colors are required, opaque six-digit hex values. other roles default from them; optional role overrides accept six- or eight-digit hex. CSS expressions, URLs, unknown roles, and duplicate ids are rejected. license name, full text, and author are required; an optional source must use HTTPS. preserve upstream notices when distributing an adapted palette. registered data is copied and frozen.

`list()` returns available palettes with fully qualified ids. `getPreferences()` returns `{ mode, light, dark }`; `setPreferences(partial)` updates mode or a light/dark selection using those ids. selected ids must match the requested appearance. the [generated contract](../reference/colorscheme-api.md) lists every role. this additive API keeps addon API version 1.

base colors use the `hibi-base` CSS layer and palette colors use `hibi-theme`. existing unlayered `context.styles` rules retain precedence. a palette changes tokens without rebuilding either editor. workspace snapshots include optional appearance preferences; exported documentation bundles audited built-in palettes only, falling back to hibi for addon palette ids.

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

manifests may include a plugin `version` and `authors`, an array of `{ discordId, displayName }` records. bundled plugins share entries from `src/addons/authors.ts`. these fields are optional for older API v1 addons; new plugins should supply both. settings → addons shows version and display names, with Discord IDs in author tooltips.

an addon may export a `Settings` React component alongside `manifest` and `start`. enabled plugins with that component get a page under the sidebar's **plugins** section. the entire section disappears when none are available. the host supplies the page heading and metadata; use shared `SettingRow`, `Toggle`, `Button`, and `Select` components for its content. a settings component is mounted only while its page is open. plugin settings failures are isolated from the editor.

`context.editor.registerSource({ id, create })` installs a CodeMirror extension in each source editor. `create` may return a promise for a lazy import. keep its resources scoped to the editor lifecycle; registrations disappear when the addon stops. reconfiguration preserves document content and history. `context.editor.runCommand(command)` runs hibi's normal file flow and resolves to `false` on cancellation or failure. the vim addon demonstrates both APIs.

`context.editor.registerRich({ id, attach })` attaches behavior to each visual editor without recreating its schema or undo history. `attach(editor)` receives the Tiptap editor and must return a cleanup function. register and unregister ProseMirror plugins through the editor, and remove any other listeners in that cleanup. the host detaches on unregister, addon shutdown, editor replacement, and unmount; errors use the addon error notification. this hook cannot add schema nodes or marks. the slash-commands addon demonstrates paired rich and source integrations with one popup.

## dialogs

`context.dialogs` provides lifecycle-owned `open`, `alert`, `confirm`, and `prompt` dialogs. they use the same queue and modal shell as built-in UI; stopping an addon cancels its active and queued dialogs. see [dialogs and modals](dialogs.md) for custom content, return values, validation, and cleanup, and the [generated API](../reference/dialog-api.md) for signatures.

## status pills

`context.statusBar.register({ id, label, tooltip?, when?, onClick? })` adds a bottom-left status pill and returns `update(changes)` and `dispose()`. use a local unique id; the host prefixes it with the addon id. `when: 'source'` limits the pill to markdown and split views. an empty label hides it, and an empty status bar takes no space. settings hides editor status pills. labels are plain text; an optional click handler makes a pill a button.

```typescript
const mode = context.statusBar.register({
  id: 'mode',
  label: 'vim · normal',
  tooltip: 'vim mode in the markdown pane',
  when: 'source',
})
mode.update({ label: 'vim · insert' })
// Dispose when the owning editor view closes; addon shutdown also removes it.
mode.dispose()
```

updates after disposal are ignored. status click failures use the host's error notification. the vim addon owns one pill per source editor and updates it on mode changes.

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

### slash actions from addons

an existing command can opt into the slash menu with `slash: { label, description, keywords?, when?, transform }`. `when(source)` controls availability for the complete active note. `transform(source)` synchronously receives the whole note with the slash query removed and returns its replacement, or `null` to cancel without an edit. keep transforms pure. frontmatter's command shares one `addFrontmatter` transform between the palette and slash menu.

```typescript
context.commands.register({
  id: 'properties',
  label: 'add properties',
  run: () => context.editor.updateMarkdown(addProperties),
  slash: {
    label: 'properties',
    description: 'add page metadata',
    keywords: 'frontmatter yaml',
    when: source => !hasProperties(source),
    transform: addProperties,
  },
})
```

`context.commands.getSlashCommands()` returns currently available contributions from enabled addons. ids are prefixed by their owner; unregister and stop remove contributions, and stale transforms cancel safely. predicate or transform errors are reported by the host without committing the draft edit. slash queries remain untouched when a transform cancels.

`context.editor.updateMarkdown(transform, { body })` can replace the projected rich body before applying a whole-note transform. the host reconstructs any metadata through the current markdown projections first. query removal and the transform commit together. this retains the existing whole-note behavior: rich editor state is rebuilt and its undo history resets. source slash actions use one CodeMirror transaction and retain undo. built-in block slash commands retain undo in either editor.

`context.workspace` opens or reads the selected workspace. `context.native.invoke` can call only that addon’s exported native methods. errors are shown in the app. native methods receive input as `unknown` and must validate their own arguments.

## css overrides and method patches

`context.styles.register(id, css)` appends an addon-owned stylesheet and returns `update(css)` and `dispose()`. ids are local and unique while registered. styles use the normal CSS cascade; prefer the shared theme tokens and targeted selectors. import CSS with `?inline` when passing it to this API. unlike a plain CSS import, this stylesheet disappears when the addon stops, fails to start, or reloads. the vim addon uses this for its editor styles.

```typescript
const style = context.styles.register('appearance', `
  :root { --accent: #a6d3e8; }
  .app-statusbar { font-size: 11px; }
`)
style.update('.app-statusbar { font-size: 12px; }')
style.dispose()
```

`context.patches.before`, `after`, and `instead` wrap mutable renderer methods. each takes a target object, method name, and callback, and returns an undo function. the target must own a function-valued data property; pass a class prototype explicitly to patch its methods. getters, frozen objects, and immutable module exports are not patch targets.

- `before(target, key, (args, receiver) => newArgs | void)` can replace arguments.
- `after(target, key, (args, result, receiver) => result)` must return the result to keep or replace it. promise-returning methods pass the promise unchanged; return a chained promise to change its resolved value.
- `instead(target, key, (args, next, receiver) => result)` replaces behavior. calling `next(...args)` continues through the remaining patches and base method with the original `this`. skipping `next` suppresses that behavior.

`context.app` exposes shared `runAction(AppCommand)` and `runCommand(DocumentCommand)` methods. toolbar, palette, and keyboard actions use these same targets; addon file commands also use `runCommand`. this lets an addon change base command behavior without patching a private React closure. normal `runCommand` retains native file dialogs, unsaved-edit checks, and path validation. skipping it does not grant filesystem access or bypass the main process.

```typescript
const undo = context.patches.instead(
  context.app,
  'runAction',
  ([command], next) => next(command === 'normal' ? 'markdown' : command),
)
context.patches.after(context.app, 'runCommand', ([command], result) =>
  result.then(saved => {
    if (saved && command === 'save') context.notify('saved by my addon')
    return saved
  }),
)
undo()
```

patches compose in registration order, with the first patch outermost (`before` hooks run first-to-last and `after` hooks unwind last-to-first). each invocation uses a snapshot of its chain. disabling an addon removes only its patches, even when other addons patch the same method. the original property descriptor returns after the last patch is removed; a method replaced outside the API is left alone. calls already running may finish, so addons must cancel their own asynchronous work when needed. callback errors propagate; the host never retries a potentially destructive operation after a failed hook.

these APIs run trusted renderer code. they do not load code or CSS from note contents, add native permissions, or rewrite source strings at runtime. renderer overrides are not copied into exported documentation sites. keep overrides in addon source, document their effects, and use `stop` for resources not owned by these APIs.

## native entry

export a `NativeAddon` with an id and a map of asynchronous methods. `context.workspace.snapshot()` returns markdown pages with relative paths. `context.exportHtml()` asks the user where to save and writes the HTML there. never register a generic filesystem or arbitrary IPC dispatcher.

the working implementation lives in `src/addons/documentation/`. see [exporting documentation](../guides/exporting.md) for its behavior and [the generated API reference](../reference/addon-api.md) for exact signatures.

## markdown extensions

an extension can provide an optional React `Editor` component above the rich document. it receives the complete Markdown as `value`, an `onChange(source)` callback, and `disabled`. return `null` for notes where the UI does not apply. use the callback to keep both editor panes synchronized; honor `disabled` during file operations. the component unmounts when its addon is disabled.

commands may call `context.editor.updateMarkdown(transform)` to synchronously transform the latest note. this marks changes unsaved and rebuilds editor state; it throws while a file operation is running. use this for explicit commands, and use the component callback for ongoing field edits. existing addons remain compatible with API version 1.

`context.editor.registerMarkdown` registers a pure `parse(source)` projection with a local id. return `null` for unrecognized documents, or `{ content, serialize }` to expose a visual-editing body and reconstruct the complete source after an edit. `readOnly: true` can protect unsupported variants. projections compose in registration order; serialization runs in reverse order.

the host removes registrations when the addon stops, preserves source text while editor capabilities change, and isolates parser errors with a read-only fallback. changing editor extensions rebuilds the visual editor, so its undo history resets; the current document stays intact. keep metadata untouched in `serialize` and avoid side effects in parser callbacks. `src/addons/frontmatter/` is the working example.

## shared navigation

import `Sidebar` from the UI SDK at `src/addons/ui.ts`. it supports nested tree navigation or a flat tab list, optional headers/footers, keyboard focus, and a sliding selected background. hibi settings, the workspace picker, and exported documentation use this same implementation.

the optional `resize` prop adds the shared pointer and keyboard resize handle. pass the current width, maximum width, change callback, and reset callback, and apply that width to `--sidebar-width` on the containing layout. core desktop and static-site layouts share the internal `useSidebarResize` controller for clamping and local persistence.

## compatibility

the public API is version 1. manifests declare `apiVersion`; incompatible manifests are rejected. preserve existing signatures when adding capabilities. breaking changes require an API version bump, addon migration, and documentation updates.

`npm start` regenerates API references when their source declarations change. outside watch mode, run `npm run docs` after changing public types. `npm run docs:check`, included in `npm run check`, fails if generated references differ from the actual SDK or shared types. keep your addon’s README updated with behavior changes.
