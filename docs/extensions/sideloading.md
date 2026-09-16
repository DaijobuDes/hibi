# sideloading

choose **install addon…** in settings → addons, or **install theme or extension…** in the palette. select a package folder containing `hibi-addon.json` and `README.md`. review its metadata and trust notice. packages install disabled; enable or remove them in settings. no restart is needed.

packages live in private application data. opening a workspace never installs or executes its code. disabled installed extensions are not imported. replacement installs use a fresh module url and start disabled; their old package goes to trash after successful replacement. removal stops contributions and moves the package to trash.

limits: 1,000 entries, 25 mib total, 5 mib per file, and 64 kib per manifest. symlinks, hidden files, invalid paths, and executable binaries are excluded/rejected. packages may contain compiled javascript, json, css, fonts, images, audio, markdown, and text. native addons remain modules built with hibi. sideloaded extensions run trusted renderer code with document/workspace api access, without node integration or arbitrary network access. this is not an isolation boundary for hostile extensions.

## extensions

```json
{
  "id": "example", "name": "example extension", "kind": "extension",
  "version": "1.0.0", "apiVersion": 1,
  "description": "an example command.",
  "authors": [{ "displayName": "your name" }],
  "entry": "index.js"
}
```

the compiled browser es module exports a factory receiving the host sdk. use its react/editor instances rather than bundling another copy. relative imports may reference package files.

```js
export default ({ React, ui }) => ({
  start(context) {
    context.commands.register({
      id: 'hello', label: 'example: hello',
      run: () => context.notify('hello'),
    })
  },
  Settings() {
    return React.createElement(ui.SettingRow, {
      id: 'example-setting', label: 'example setting',
      description: 'shared rows appear in the palette automatically.',
    }, React.createElement(ui.Button, null, 'example'))
  },
})
```

the sdk provides `React`, `ui`, `tiptap`, `codeMirror`, and `markdown.Marked`. return normal addon lifecycle, settings, and flavor contributions without a second manifest. see [sdk](../reference/sideload-sdk.md) and [addon api](../reference/addon-api.md).

## themes

use `kind: "theme"`, omit `entry`, and add a `themes` array of [colorscheme definitions](../reference/colorscheme-api.md). each includes `id`, `name`, `appearance`, `author`, full `license`, and `colors`. the six required hex colors are `background`, `surface`, `ink`, `muted`, `accent`, and `border`; other semantic tokens are optional. theme packages contain data only.

enabled colorschemes appear in appearance settings and the palette. removing an active theme restores hibi's fallback palette. retain original authors and complete license notices. manifest `licenses` entries and theme licenses appear in hibi's license dialogs. author records support `displayName`, optional `discordId`, `github`, and `role`.
