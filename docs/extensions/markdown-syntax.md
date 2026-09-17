# markdown syntax

settings → **syntax** controls which formatting hibi renders. each heading level has its own switch, alongside bold, italic, inline code, escapes, code blocks, quotes, lists, dividers, line breaks, links, media, and html. enabled extensions add their own switches: github tables, tasks, strikethrough and alerts; math; typst blocks; subscript and small text.

turning a feature off shows its original markdown in rich editing and exports. it does not delete content or rewrite the source. these preferences apply across documents and persist between launches. disabled rich-formatting commands become unavailable; source remains plain editable markdown. paragraphs and plain text always remain available. html still passes through export sanitization, and unsupported raw html keeps the rich editor's existing read-only protection.

**code syntax** is separate: its switches control highlighting per language, while code blocks remain readable. see [code languages](code-languages.md).

## subscript and small text

the bundled **text extras** extension supports `H~2~O` and a line starting with `-# ` for discord-style small text. both have toolbar actions and individual syntax switches. `~~text~~` remains strikethrough. subscript cannot span newlines or have surrounding whitespace. enter after small text continues with a normal paragraph. automatic flavor detection recognizes existing syntax; use the flavor picker to enable it before formatting a new document.

## extension api

register each renderable feature alongside its markdown flavor:

```ts
context.editor.registerSyntax({
  id: 'callout',
  label: 'callouts',
  group: 'my extension',
  description: 'custom callout blocks.',
  level: 'block',
  extensions: ['callout'],
  matches: (token) => token.type === 'callout',
})
```

ids are local to the addon and stored as `addon-id.feature-id`. `matches` receives lexer tokens; it must be synchronous and must not mutate tokens. `level` chooses editable block or inline literal fallback. `extensions` lists associated tiptap extension names. register tokenizers through the flavor's `export.extensions` too, so disabled rich extensions still have complete tokens to preserve as literal text. do not remove tokenizers when a preference changes.

`context.editor.isSyntaxEnabled('callout')` reads the preference. `context.editor.onSyntaxChange(listener)` observes changes; use it when extra plugin behavior depends on a feature. registration and listeners return cleanup functions and are disposed automatically when the addon stops. preferences survive disable/re-enable. new registrations appear in settings and the command palette without a separate settings page.

this is an additive addon api v1 feature. existing addons continue working; unregistered syntax remains enabled. see [syntax types](../reference/markdown-syntax-api.md) and [addon api](../reference/addon-api.md).
