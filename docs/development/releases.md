# Nightly releases

Hibi is licensed under AGPL-3.0-only. Its root `LICENSE` is included in packaged applications.

The `nightly` GitHub Actions workflow runs from `main` daily at 18:00 UTC (02:00 Manila time). It can also be started from Actions → nightly → Run workflow. GitHub may delay scheduled runs. Unchanged revisions are skipped.

Each release has a dated `nightly-YYYY-MM-DD-<commit>` tag and a prerelease version. Its changelog lists actual commits since the previous reachable nightly tag, with commit and comparison links. The first nightly includes history since the most recent reachable release tag, or all commits if none exists. Notes live with the release, so publishing does not create another source commit.

Four native build jobs run `npm run check` before packaging:

- Linux x64: AppImage.
- Windows x64: NSIS installer.
- macOS Apple Silicon: DMG and ZIP.
- macOS Intel: DMG and ZIP.

Publication waits for every platform. Installers and `SHA256SUMS.txt` are attached to a GitHub prerelease; temporary Actions artifacts expire after one day. Failed uploads leave a draft for a workflow retry. Runs are serialized, and release tags are never force-moved. The built source commit is fixed before platform jobs start.

Release notes start with the short source SHA, a backup warning using GitHub's `:warning:` emoji, and direct Windows, macOS Intel, and Linux AppImage links. Each download, including Apple Silicon and ZIP archives, has its own linked SHA256 entry from the generated checksum file. The changes section follows these download details.

All packages retain `com.ryanaque.hibi` and the Hibi icons from `electron-builder.yml`. Nightlies use the regular installed app's data profile. Save and back up documents before installing them. Windows packages are unsigned; macOS packages use ad-hoc signing without notarization. Trusted distribution signing requires separately configured signing credentials.

The workflow uses the repository's built-in token; only the publication job has `contents: write`. No additional secret is needed. To check changelog generation locally, run `node --test tests/nightly.test.mjs`; workflow syntax is checked with `actionlint`.

Nightlies share the incremental checks/cache with regular CI. Select `clean` on a manual run to rebuild and run all tests without caches. A clean run can rebuild an unchanged revision for validation; it keeps an already published prerelease intact rather than replacing its assets.

## Website addon catalog

`.github/workflows/addons-sync.yml` runs on pushes to `main` that change `src/addons/**`. It can also be run manually for an initial sync. `node scripts/export-addons.mjs` exports `authors.ts`, manifests, Markdown files, and images into `out/addons`, preserving relative paths. Runtime TypeScript, stylesheets, audio, hidden files, and symlinks are excluded; manifests are copied without being executed.

The workflow updates the generated catalog in `hibigarden/site/addons`, removes stale catalog files, and preserves `addons/index.html`. It validates the site's tests and build before committing `chore(addons): sync to main (<source short commit id>)`. Unchanged catalog data creates no commit. Serialized runs use normal pushes so concurrent site work is never overwritten.

Configure `ADDONS_SYNC_TOKEN` on **schmayterling/hibi**, with access to `hibigarden/site` and Contents read/write permission. A secret on the destination repository cannot be read by the source workflow. Documentation publishing remains independent: `docs-sync.yml` runs only when `docs/**` changes on `main`.
