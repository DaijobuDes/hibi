# Offline dictionary packs

Enable **Dictionary and thesaurus** in **Settings → Addons**, then open its settings. Choose **Install pack** for English, Chinese (Mandarin), Cantonese, Japanese, Filipino (Tagalog), French, or German. You can also run **Dictionary: install offline pack** from the command palette.

Each pack shows its approximate download size, publisher hosts, sources, and licenses before installation. Mandarin includes both simplified and traditional spellings. Japanese includes kanji and kana readings. Definitions are in English.

Leave Hibi open while the pack downloads and prepares. Progress appears beside the pack, and **Cancel** stops the operation. French downloads about 58 MB, Filipino about 16 MB, and German about 98 MB. Slow downloads stop after a minute without data. Each source also has a total time limit based on its expected size at 50 KiB/s, plus one minute of extra time; occasional bytes do not extend this limit. Other installed languages remain available while a pack downloads or prepares.

Once installed, place the cursor in a word or select it, then run **Define word** or **Find synonyms**. Hibi checks installed packs first. If they contain an answer, the lookup needs no network request. If they do not, Hibi may offer an online lookup through its usual permission prompt.

Definitions and readings are more complete than thesaurus data for Chinese and Japanese. Filipino, French, and German use the synonyms and antonyms available in Wiktionary.

Choose **Update** to download the latest source again. The old pack stays installed until its replacement is ready, including when a download fails or is canceled. Update regularly for source corrections. **Uninstall** removes the pack; disabling the addon keeps installed packs for later.

If installation fails, retry from the same settings page. A damaged pack can be installed again. Hibi downloads only from the listed publisher hosts and rejects redirects to other hosts.

Packs belong to your Hibi profile and are shared by its workspaces. Hibi does not bundle or host the source dictionaries. Downloading a pack never sends document content or lookup words.

Source credits and licenses are available offline under **Settings → Credits**. The [addon's source list](../../src/addons/dictionary/README.md#offline-dictionary-sources) includes official download links, source versions, sizes, and licensing details.
