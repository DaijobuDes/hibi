# code highlighting

settings → **code highlighting** lists built-in languages and active extension contributions. toggle a language to enable/disable highlighting in source fences, rich code blocks, and documentation exports. its aliases share the same toggle. disabled code remains intact and readable; preferences persist across restarts and extension reloads. new registered languages appear automatically. the compact filter searches names and aliases; **reset all** enables every language, including entries hidden by the current filter.

label fenced code with a language (`javascript`, `ts`, `python`, and so on). hibi uses the same parser registry in markdown/source panes, normal view, and documentation exports. highlighting is visual: it does not execute code, change Markdown, move selections, or reset undo history. unlabelled and unknown languages stay plain text.

built-ins: javascript, typescript, jsx, tsx, html, css, json, python, yaml, sql, java, c/c++, rust, go, shell, powershell, c#, ruby, swift, toml, and dockerfile. common short names such as `js`, `ts`, `py`, `yml`, `sh`, `rb`, and `cs` are recognized. fence names are case-insensitive; trailing info such as a filename does not affect the language.

## extension api

`context.editor.registerCodeLanguage({ id, aliases?, language })` registers a CodeMirror `Language`. use a language package's `.language` or `StreamLanguage.define(...)`. registration returns a cleanup function; the host also cleans it up when the extension stops. later registrations override earlier languages/aliases and cleanup restores the previous grammar. source and rich editors update in place.

sideloaded modules can use the shared parser runtime:

```js
export default ({ codeMirror }) => ({
  start(context) {
    context.editor.registerCodeLanguage({
      id: 'example', aliases: ['ex'],
      language: codeMirror.language.StreamLanguage.define({
        token(stream) {
          if (stream.match(/^#[^\n]*/)) return 'comment'
          if (stream.match(/^(let|print)\b/)) return 'keyword'
          if (stream.match(/^\d+/)) return 'number'
          stream.next()
          return null
        },
      }),
    })
  },
})
```

the sdk exports `codeMirror.language` and `codeMirror.highlight` alongside state/view/commands, so extensions can share language tags and runtime classes. grammar code must come from an enabled addon, never a workspace file.

themes may override `syntax-keyword`, `syntax-string`, `syntax-number`, `syntax-comment`, `syntax-type`, `syntax-function`, `syntax-variable`, and `syntax-operator`. older themes derive sensible values from their existing colors. exports embed generated spans and token styles, without shipping extension code. source highlighting uses CodeMirror's incremental parser; rich view caches unchanged blocks and leaves blocks above 100,000 characters unhighlighted to keep editing responsive. export preserves those blocks as complete plain text too.

see [code language types](../reference/code-language-api.md), [addon api](../reference/addon-api.md), and [sideload sdk](../reference/sideload-sdk.md).
