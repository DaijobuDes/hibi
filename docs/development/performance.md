# Startup performance

See [the recorded comparison](startup-measurements.md) for measured gains, tradeoffs, and validation limits.

Run `npm run build`, then `node scripts/benchmark-startup.mjs > startup.json`. `HIBI_BENCH_RUNS` controls repetitions (default five). The report separates a minimal Electron page, fresh profiles, retained-profile relaunches, and macOS window reopening. It measures editor availability, the first displayed keystroke, subsequent typing latency, loaded scripts, and the emitted static dependency graph. The first retained-profile run is reported separately as cache priming.

Process-launch scenarios seed three recent workspaces in each isolated profile. `readyMedian` and `readyP95` require both editable text and all three enabled workspace buttons, before typing dismisses the start screen. `startedAt` and each process's `timeOrigin` allow checkpoints to be compared on the same launch timeline. The recent-workspace list is distinct from opening and indexing a workspace's files.

Set `HIBI_BENCH_DOCUMENTS=1` to measure opening synthetic large and code-heavy notes after launch, including the first source-view switch. `HIBI_BENCH_ADDONS=math,typst,vim,graph` repeats the scenarios with a representative enabled-addon profile. Document-open latency is reported separately from process startup.

Measurements use production assets in the test Electron runtime with hidden windows and isolated temporary profiles. Automation adds latency. A fresh profile is **not** an OS cold-cache launch; the script never clears machine caches. Packaged launch measurements and other platforms must be reported separately. Use median and p95; do not promise a launch budget from a single run.

Main and renderer checkpoints use the `hibi:` performance-entry prefix. Entry checkpoints occur **after static imports**, not at OS process launch. Native startup reads have separate durations. Renderer document availability and required editing capabilities are distinct from window painting. No benchmark telemetry leaves the machine.

Renderer `hibi:addon:<id>` spans include each enabled implementation's import and startup hook. A long span can include another addon's blocking work; use a CPU profile to identify the caller. In particular, a cold `AudioContext` can synchronously query the audio device. keybeats starts asynchronous [device discovery](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices) before creating its context, keeping that service preparation off the editor's critical path. Discovery respects the existing media permissions; it requests no capture permission and stores no device details.

`out/renderer/startup-bundle.json` records chunk sizes, static/dynamic imports, and module membership. Follow static imports from entry chunks when comparing startup cost; a separate chunk alone does not establish lazy loading.

The `app://` scheme allows V8 code caching. Native addon implementations load on their first authorized call, with shared in-flight imports and a second enabled-state check after loading. Worker entrypoints resolve from the application root so chunk splitting does not change their locations.

macOS uses the installed bundle's icon directly. Development sets a 256px dock icon once instead of repeatedly encoding the 1024px source through both the dock and window constructors. Windows and Linux retain their window icons. Addon archive downloading and extraction load only when installing a remote addon.

Independent native preferences load concurrently. Appearance, protocol security, permission policy, and IPC registration precede navigation; other preference reads overlap renderer loading. IPC waits for those reads before accessing session state or processing edits.

The recent-workspace list is read alongside document metadata and addon preferences, before editor capabilities finish loading. Reapplying the current interface casing does not rewrite preferences or rebuild the native menu.

Addon activation waits for the initial document name before classifying required formats; an unknown filename must not start every enabled format engine on the critical path. Keyboard sounds use the background startup lane because they do not change document editing or serialization.

Renderer catalogs import data-only manifests and optional lightweight `flavor-info.ts` descriptors. Implementations load only when enabled. Keep syntax detection separate from nodes, renderers, fonts, and export code so disabled flavors remain discoverable without loading their engines. `Settings.tsx` is a separate lazy boundary; shared runtime preferences belong outside it.

The shell can render before document capabilities finish. Enabled schema, serialization, matching document formats, and input addons must finish `start()` before editing begins. A failed required addon leaves source-only editing available. Unknown API v1 addons keep this conservative behavior. `startup: 'background'` is only for services/UI that do not change editing semantics. Unrelated enabled formats and background services activate at idle after required capabilities; disabling an in-flight addon invalidates its activation and scoped registrations. Existing editors stay mounted and inert during required capability changes.

Built-in code languages retain metadata at startup, cache in-flight and completed parser loads, and update decorations without changing source or undo history. Disabled languages stay disabled even if an import finishes afterward. Async Markdown exports await requested parsers; synchronous API v1 exports may initially contain escaped plain code. Settings, history, and palette UI load on interaction. Palette search mounts settings discovery on demand instead of duplicating control metadata.

Source-editor code may warm during idle, but its editor instance mounts only when a source view is requested. Fonts/layout and async source input extensions finish before source view reports readiness. This avoids constructing an unused editor while retaining import warmup for the first view switch.

Settings remain mounted after their first interaction to retain navigation state. Opening the palette also discovers enabled plugin controls, without loading them at application startup. Casing preferences initialize independently of settings. Initial rich-editor focus is synchronous with mounting; it never schedules a later selection reset over a user's selection. Failed source input extensions display an error with the source read-only until the extension is disabled or loads successfully.
