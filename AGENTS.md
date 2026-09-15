# hibi development

- keep core, renderer, shared UI, and addons separate. workspace content must never execute as addon code.
- put documentation in markdown under `docs/`; every addon has a `README.md`.
- update prose docs in the same change as behavior. public API changes must regenerate references with `npm run docs` and pass `npm run docs:check`.
- preserve API compatibility; breaking SDK changes require an API version bump and addon migrations.
- reuse the shared sidebar for settings, workspace navigation, and exported sites.
- keep IPC narrow and validate paths in the main process. preserve unsaved edits and external-change checks.
- validate with `npm run check`; commit progressively. keep user notes and private addons out of commits.
