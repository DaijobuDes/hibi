# Autocomplete

Enable **Autocomplete** in **Settings → Addons**. It requires **Dictionary and thesaurus**. Installed offline dictionary packs supply suggestions before anything has been learned; autocomplete never downloads packs or sends network requests. Dictionary lookups and pack installation remain separate actions in the dictionary addon.

Type at least three Latin letters to see word suggestions. After a space, the preceding one or two words can suggest the next word when repeated use gives one choice a clear lead. Repeatedly writing “bro that was wild” can suggest “wild” after “that was”; unrelated contexts show nothing. English, French, German, and Filipino can be used together. Choose the languages in Autocomplete settings. Chinese and Japanese word segmentation is not supported yet.

Suggestions start with no word selected. Use the arrow keys to highlight a word completion and Enter to accept it. For next-word suggestions after a space, Enter always starts a new paragraph, even after highlighting a choice. **Accept suggestions with Tab** is on by default: Tab accepts the highlighted suggestion, or the first suggestion when none is highlighted. Turn it off to leave Tab to the editor while suggestions are visible. Escape dismisses the list. Accepting a suggestion makes one undo step. The dictionary's previous suggestion, language, and Tab preferences move to Autocomplete on first use.

## Learning and privacy

Autocomplete learns from words committed while typing, not from opening documents or pasting text. Accepted words receive a small boost. Undoing or overwriting an accepted suggestion within ten seconds reduces its influence; ignoring a suggestion does not count against it. Repeated observations matter more than one unusual word. Spelling, capitalization, slang, and mixed-language patterns are kept as written. Older observations gradually lose influence, with a thirty-day half-life.

Learning and ranking happen on this device. Each Hibi profile keeps separate data. Workspaces keep separate histories, and documents outside workspaces share their own history. Workspace words are never used as a global fallback. Dictionary custom words remain available as vocabulary independently of learning.

Stored data contains individual words, counts, correction counts, timestamps, language membership, and at most two preceding words per entry. It does not contain complete sentences, documents, or a keystroke log. Up to 4,096 aggregate entries across sixteen recent scopes are kept; old or weak entries are pruned. Data lives in Hibi's addon storage inside your profile, outside workspace folders.

Code blocks, inline code, frontmatter, link URLs, math, raw HTML, and secret-looking text are excluded. These checks are conservative, not a way to recognize every secret. Use **Exclude this document** or **Exclude this workspace** for private writing. Exclusions stop learning and personal suggestions there; they do not erase words already learned. Clear the relevant history to remove existing data.

Turn off **Learn from my writing** to pause learning and personal ranking. Offline dictionary suggestions still work. Turning learning off discards queued observations and keeps existing stored counts for later.

## Clear learned words

Choose **Clear learned words** in Autocomplete settings, select **This workspace** or **All workspaces**, and confirm. Outside a workspace, the first choice clears the shared history for documents outside workspaces. You can also run **Autocomplete: clear learned words** from the command palette.

Clearing removes the selected counts from memory and writes the cleared data to disk immediately, including histories for workspaces that are not open. The success notice appears after the disk write completes. Dictionary packs and custom dictionary words are kept. New typing can begin learning again while learning is enabled.

## Current limits

Suggestions use the existing completion list in both editors. The formatted editor currently inserts completions in top-level paragraphs and headings. Source view conservatively checks the first 16,384 characters for safe prose; later text does not contribute to autocomplete until that syntax proof can be maintained incrementally. Very long formatted textblocks have the same proof limit. Suggestions may be absent around unsupported or incomplete syntax.

The starting dictionary ranking favors exact accent matches and single words, then languages in the order you enabled them and shorter words. Lowercase headwords rank ahead of names unless you type a capital; German nouns keep their normal capitalization. Packs supply a limited prefix list without frequency information, so the most common word is not always present. Personal ranking improves with repeated use; it does not attempt sentence generation.
