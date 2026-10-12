# dictionary pack fixture sources

These are small excerpts of the official files downloaded on 2026-10-12.
Definitions, forms, readings, and entity declarations retain upstream text.

- `en.xml`: [Open English WordNet 2025](https://en-word.net/downloads/english-wordnet-2025.xml.gz), Global WordNet Association, [CC BY 4.0](https://en-word.net/license.html). Selected lexical entries and synsets form a closed sample for go/went, child/children, mouse/mice, dog synonyms, and happy/unhappy antonyms. Unrelated senses and relations are omitted.
- `zh.txt`: [CC-CEDICT](https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz), MDBG and CC-CEDICT contributors, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Original source header retained; entry count describes the complete source, not this excerpt.
- `yue.txt`: [CC-Canto 2017-02-02](https://cantonese.org/cccanto-170202.zip), Pleco Inc., [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Includes unchanged upstream extra-brace reading, empty pinyin, and trailing-comment records.
- `yue-readings.txt`: [CC-CEDICT Cantonese readings 2015-09-23](https://cantonese.org/cccedict-canto-readings-150923.zip), Pleco Software Incorporated, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- `ja.xml`: [JMdict_e](https://www.edrdg.org/pub/Nihongo/JMdict_e.gz), Electronic Dictionary Research and Development Group, [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html). Two complete entries; DTD reduced to the original internal entity declarations used by those entries.
- `tl.jsonl`: [Tagalog Wiktionary via Kaikki](https://kaikki.org/dictionary/Tagalog/kaikki.org-dictionary-Tagalog.jsonl), Wiktionary contributors and Tatu Ylonen's Wiktextract, [CC BY-SA 4.0 / GFDL](https://kaikki.org/dictionary/Tagalog/). Complete original JSON objects retain source sense IDs and example attribution.

Synthetic malformed records and archive mutations are generated in the test file; they are not source excerpts.
