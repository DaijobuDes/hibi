# slash commands

enabled by default. type `/` at the start of a paragraph in normal view, or a line in a markdown pane. type a command name or keyword to filter; use arrow keys and enter or tab to select, or click an item. escape and outside clicks close the menu without deleting your text.

commands: text, headings 1–3, bullet list, numbered list, checklist, quote, code block, divider, and table. source commands insert markdown at the cursor; rich commands use the editor's block commands. each conversion can be undone.

the menu stays out of code blocks, inline code, frontmatter, URLs, and paths. vim normal-mode `/` remains search; slash commands work in vim insert mode. disabling the addon removes both editor integrations and its stylesheet.

`commands.ts` owns the command list. `rich.ts` uses `context.editor.registerRich` to attach a ProseMirror plugin without replacing editor state. `source.ts` uses `registerSource`; both share `menu.ts` and hibi's command-list styles and theme tokens. no workspace content runs as code.
