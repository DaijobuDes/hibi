# settings

**hibi** is the first settings page and the initial selection. it shows the page icon, app name, version, and creator credit using hibi's shared panels and controls. app and Electron versions also remain in the sidebar footer.

**back to app** sits above the settings categories in its own unlabeled sidebar section. it returns to the current document and restores editor focus, like the top-bar back button.

**sponsor on github** opens [may's GitHub Sponsors page](https://github.com/sponsors/schmayterling) in your default browser. this action uses a fixed destination; workspace content and addons cannot supply arbitrary external URLs through it.

## syntax and code syntax

**syntax** toggles markdown features individually, including each heading level and extension-provided formats. **code syntax** toggles highlighting per language. both retain the original source. see [markdown syntax](../extensions/markdown-syntax.md) and [code languages](../extensions/code-languages.md).

## notifications

appearance → notifications controls notification placement (top/bottom, left/middle/right) and automatic dismissal (3, 5, 8, or 10 seconds, or never). **show preview** tries the current settings. notifications slide upward and fade in, with a bottom progress line. hover or keyboard focus pauses the countdown; leaving resumes it. the dismiss button always closes immediately with a short exit fade.

## open source licenses

the bottom section lists application dependencies, bundled colorscheme notices, and addon-provided third-party notices. each row shows the package version when available and license identifier. select a row to read its complete license/notice text in a shared dialog. escape, the close button, or clicking outside dismisses it and returns focus to the row. long text wraps inside the dialog.

the catalog is generated from installed runtime dependency manifests during desktop builds. build tools and Electron's binary installer dependencies are excluded; transitive application packages are included. different installed versions retain separate entries. notices are shipped locally in `out/licenses.json`, so viewing them works offline and no package text is fetched from the network. Electron's additional runtime notices are preserved separately in packaged resources at `licenses/electron-third-party.html`.

maintainers: `scripts/licenses.ts` owns collection and the build-tool exclusion list. missing package notice files fail the build. `src/shared/theme-licenses.ts` supplies the pinned colorscheme notices. package upgrades regenerate the catalog automatically.
