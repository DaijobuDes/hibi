# Dictionary and thesaurus

Look up an English word's definitions and synonyms without leaving your document. Enable **Dictionary and thesaurus** under **Settings → Addons**. It is off by default because lookups use online services.

Place the cursor in a word or select one word, then choose **Define word** or **Find synonyms** from the command palette or the editor's right-click menu. **Find synonyms** also has the default shortcut `Shift+F7`, which you can change under **Settings → Hotkeys**. Both commands work in the formatted editor and in Source view.

**Define word** shows each part of speech with numbered definitions, an example when one is available, and related synonyms. **Find synonyms** shows synonyms and antonyms. Choose any of these words to replace the word you looked up. A capitalized word stays capitalized, and one undo restores the original. Press Escape to close the results and return to your document.

## Privacy

Hibi sends nothing while you type. When you run a lookup, Hibi asks before each request, and the word you looked up is sent to one of these services:

- **Define word** sends the word to the [Free Dictionary API](https://dictionaryapi.dev/) at `api.dictionaryapi.dev`.
- **Find synonyms** sends the word to the [Datamuse API](https://www.datamuse.com/api/) at `api.datamuse.com`, once for synonyms and once for antonyms.

Only the word is sent, never the rest of your document. Answers are kept in memory until the addon is disabled or Hibi closes, so looking up the same word again does not send another request. Datamuse says it keeps a log of queries for the rest of the day and then discards it.

## Services and limits

The Free Dictionary API is a free service with no account or key. It does not publish a request limit, but it can reject requests when busy. Its definitions come from [Wiktionary](https://en.wiktionary.org/) under the license shown below the results, usually CC BY-SA.

Datamuse allows up to 100,000 requests per day without a key. Its [API page](https://www.datamuse.com/api/) says it will require an API key for every request starting in early 2027. Synonym lookups may stop working at that point until Hibi supports a key. Thanks to Datamuse for providing the API.

If a service cannot be reached, is limiting requests, or has no entry for the word, the results explain what happened. Choose **Try again** after reconnecting or waiting a minute. Only English words are supported.
