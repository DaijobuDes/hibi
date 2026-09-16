# slash commands

the bundled slash-commands addon is enabled by default. toggle it in **settings → addons**.

start a paragraph or source line with `/`. type a name or keyword, such as `/h2`, `/todo`, or `/table`. use ↑/↓ to navigate and enter or tab to select, or click a result. escape or an outside click dismisses the menu and leaves the text unchanged. ordinary slashes in URLs and paths remain ordinary text.

available blocks: text, headings 1–3, bullet lists, numbered lists, checklists, quotes, code blocks, dividers, and tables. the normal editor changes the current block; source panes insert its markdown syntax. undo restores these block commands. the popup stays within the window and supports reduced motion.

enabled addons can contribute whole-note actions. frontmatter adds `/frontmatter` (also found with `/properties`, `/metadata`, or `/yaml`) when the note has no metadata. its action removes the slash query and adds page properties without duplicating an existing block. whole-note actions retain source-pane undo; in the rich editor they use the same editor rebuild and undo reset as their command-palette equivalents.

commands work in normal, markdown-only, and both sides of split view. they do not open inside code, inline code, or frontmatter. when vim is enabled, use insert mode for slash commands; `/` still searches in normal mode.

disabling the addon removes its editor handlers, popup, and styles without changing the note or clearing undo history. the addon lives in `src/addons/slash-commands/`; edit its command list to add bundled block types.
