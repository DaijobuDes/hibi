# Dictionary pack storage and measurements

The dictionary addon downloads official sources on request and converts them locally. Hibi neither bundles nor hosts dictionary data. See the [source catalog and licenses](../../../src/addons/dictionary/README.md#offline-dictionary-sources) and [user instructions](../../features/dictionary-packs.md).

## Installation and storage

The renderer sends a fixed language ID through the addon's native API. It cannot choose a URL, filename, or directory. Main validates that ID, downloads the catalog's HTTPS sources through the shared bounded download helper, and writes private staging files below `userData/dictionary-packs/`. Each request and redirect must retain that source's approved origin. The settings page shows approximate download sizes, publisher hosts, sources, and licenses before installation. The addon manifest declares seven canonical HTTPS origins: Wiktionary, Datamuse, WordNet, MDBG, CC-Canto, EDRDG, and Kaikki. The addon manager displays them before enabling. Credential-free lookup requests to declared public origins skip destination prompts; undeclared hosts, credentials, and private addresses retain their grants.

Download limits are separate for each source: WordNet, JMdict, and Tagalog 32 MiB, CC-CEDICT 16 MiB, each Cantonese ZIP 8 MiB, French 96 MiB, and German 128 MiB. French, Tagalog, and German use gzip downloads. Streams enforce byte limits even without a Content-Length header. A 60-second stall timeout covers waiting for headers or body bytes. Each source also has a fixed deadline of its catalog download size divided by 50 KiB/s, plus 60 seconds; arriving bytes reset only the stall timer. The deadline includes redirects, headers, and body transfer, so a slow-drip server cannot keep an installation open indefinitely. Conversion has its own 15-minute limit, beginning after all downloads finish. Cancellation aborts the fetch or terminates the conversion worker, waits for open handles to close, and removes staging files.

A Node worker thread recognizes gzip/ZIP headers and streams source records into `data.jsonl`. `index.json` stores sorted keys with byte offsets and lengths. Conversion accepts only the expected language format, rejects malformed or truncated records, bounds decompression and record counts, verifies ZIP CRCs through the existing archive helper, and never loads remote XML entities. Source archives are deleted after successful conversion.

The manifest records language, format version, installation date, source URLs, source version/date headers, licenses, download sizes and SHA-256 hashes, entry/key counts, conversion time, and output sizes/hashes. SHA-256 detects incomplete or changed local files; it is not a publisher signature. Source authenticity relies on the fixed official HTTPS origins.

A complete new pack replaces the old directory by rename. The old directory remains available for rollback if replacement fails. Recovery is lazy: the first list, lookup, preload, install, or removal for each language recovers an interrupted replacement and removes unfinished staging downloads. This also occurs when the addon's idle preload first lists packs; it is not an application-startup recovery pass. Failed or canceled updates preserve the installed pack. Uninstall unloads only that language's index and removes the pack. Disabling the addon stops active work but retains installed packs. Existing French and Tagalog manifests from uncompressed sources remain valid until updated.

The store serializes mutations and skips only the language being changed. Each conversion uses a separate short-lived worker, so other installed languages continue answering offline during downloads, conversion, cancellation, and removal. Concurrent initial reads share checksum verification. Per-language generation checks prevent stale reads from reopening a changing pack or returning results after shutdown. Converter details are logged; settings show one installation failure message.

## Lookup and bounds

The lookup worker keeps sorted spelling keys and compact 32-bit reference arrays in an LRU cache with a 256 MiB accounting cap. Typed arrays are charged their exact byte lengths; strings and their array slots receive a conservative UTF-16 allowance with object overhead. This cap describes retained index data, not total process RSS or temporary parsing allocations. The worker validates the existing sorted JSON index format and converts it to these arrays once, preserving compatibility with installed packs. Exact and normalized lookups use binary search. The worker returns bounded entry records; the renderer receives no paths. Converter headwords and aliases, lookup queries, and completion prefixes use Unicode NFC normalization. Exact keys win before case-normalized keys. A full French source audit on 12 October 2026 found all 400,911 existing index keys already in NFC, so its installed format remains compatible without rebuilding. English also uses the WordNet XML's 4,473 explicit inflected forms, including irregular forms such as `went`, `children`, and `mice`, then conservative suffix candidates that must exist in the index. Hibi does not download the separate WNDB exception archive. Chinese connects traditional/simplified pairs from the dictionaries; Japanese connects JMdict kanji and kana forms. Tagalog, French, and German add lowercase matching.

The worker has a 512 MiB old-generation heap limit. Conversion caps are one million entries, 750,000 keys, 1.5 million references, 512 MiB of entry data, and 48 MiB of index data. Each packed record is at most 64 KiB. Source decompression is capped at 512 MiB, except French's 768 MiB and German's 1.5 GiB; source records are capped at 2 MiB. The runtime admits at most 64 queued jobs. Each lookup returns at most 32 records and 512 KiB. Directory/file checks reject symlinks; the loader validates ordering, offsets, record boundaries, and key membership.

After the addon starts, an asynchronous native query schedules one preload at a time on idle main-process turns for its preferred Latin and Han languages plus the last successfully used offline pack, when installed. All other packs load lazily. Index parsing and loading happen in the lookup worker; startup does not wait for them. Preload shares checksum verification with foreground queries. A lookup arriving before preload finishes can still pay the cold-load cost. The installed-language list is cached in main and invalidated when installation, cancellation, failure, or removal changes pack state; provider availability queries return a cached boolean instead of listing every pack.

`DictionaryProvider.complete?(prefix, lang, signal, limit?)` is optional and backward compatible. Offline providers return up to eight spelling or reading keys by default, with a maximum of 32. Prefix search uses binary search over normalized sorted keys: lowercase Latin text, English apostrophe normalization, and the source's kana/kanji and simplified/traditional aliases. Results preserve the first source spelling for each normalized key; case aliases do not consume extra result slots, and accents are not removed. Empty prefixes return no results. This supplies the data path for completion without adding an autocomplete interface. Typing suggestions ask every suggestion language in one `packCompleteAll` query through `queryLatest()` in `offline.ts`: each renderer keeps at most one such query live in the native process and one waiting. A newer keystroke replaces the waiting query; an aborted caller settles at once, but the next query starts only after the live reply arrives, so canceled keystrokes cannot fill the worker's 64-request queue.

The registry checks installed providers across all candidate languages before trying any online provider. A local answer therefore makes zero online lookup requests. CC-CEDICT, CC-Canto, and JMdict do not provide a broad thesaurus. English uses WordNet relations; Tagalog, French, and German keep Wiktionary synonym/antonym fields. Other thesaurus results depend on source coverage and online fallback.

## Full-source measurements

Measured on 12 October 2026 with an Apple M2, 24 GiB memory, macOS, and Node 24.11.0. All six complete sources converted and answered the benchmark words within existing bounds. French and Tagalog were freshly downloaded through the production transport as gzip: 58,232,930 bytes in 49.02 seconds and 16,281,409 bytes in 13.10 seconds. Both HEAD requests returned HTTP 200 with matching Content-Length values. Download time is excluded from conversion timings.

| Pack | Download bytes | Installed bytes | Entries | Conversion seconds |
| --- | ---: | ---: | ---: | ---: |
| English | 11,363,503 | 52,067,519 | 135,969 | 7.21 |
| Mandarin | 3,980,329 | 35,540,839 | 125,262 | 3.71 |
| Cantonese | 7,136,893 | 38,015,289 | 133,052 | 3.77 |
| Japanese | 10,583,340 | 89,520,006 | 218,888 | 8.67 |
| Filipino (Tagalog) | 16,281,409 | 11,863,308 | 40,397 | 1.91 |
| French | 58,232,930 | 103,526,457 | 403,165 | 12.33 |
| German | 98,333,861 | 141,475,852 | 371,241 | 15.20 |

German was measured separately with the same script and machine after its addition. Its full 98,333,861-byte gzip expands to 1,085,014,820 bytes and yields 492,845 index keys. Worker preload took 474.414 ms. German's source scan found zero non-NFC headwords or forms. The earlier combined six-pack and store measurements below exclude German; adding its 97.01 MiB cache charge to the earlier six-pack charge would exceed the 256 MiB cap and trigger LRU eviction.

Installed bytes combine `data.jsonl` and `index.json`, excluding the small manifest. Retained index memory below is the change in heap usage plus typed-array buffers after explicit garbage collection in a fresh process running the same index code. Cache charge is the conservative LRU accounting value. RSS is the whole-process resident-set change, including code, temporary parsing allocations retained by the allocator, and other overhead; it is not the index's retained allocation.

| Pack | Retained heap + buffers, MiB | Cache charge, MiB | Process RSS delta, MiB |
| --- | ---: | ---: | ---: |
| English | 10.31 | 29.25 | 75.58 |
| Mandarin | 9.07 | 16.96 | 98.63 |
| Cantonese | 8.97 | 16.55 | 97.17 |
| Japanese | 23.03 | 42.10 | 279.52 |
| Filipino (Tagalog) | 2.85 | 7.18 | 36.55 |
| French | 26.13 | 77.15 | 264.39 |
| German | 36.42 | 97.01 | 296.47 |

English alone retained 10.31 MiB and charged 29.25 MiB. The actual combined default-preference preload, English plus Mandarin when installed, retained 19.23 MiB and charged 46.21 MiB. Its worker preload took 414.97 ms including worker startup; the first lookup afterward took 0.707 ms. The associated process RSS delta was 185.70 MiB. Startup also preloads the last successfully used offline language when it differs from these preferences; only its language ID is stored. Other installed packs load lazily.

All six simultaneously retained 79.37 MiB and charged 189.18 MiB, within the 256 MiB cache cap. The all-six process RSS delta was 529.47 MiB; the cap does not bound RSS, parser temporaries, or a separate active conversion worker. The 512 MiB worker heap limit also excludes typed-array buffers.

| Pack | Cold worker lookup, ms | First lookup after preload, ms | Warm lookup p95, ms | Prefix p95, ms |
| --- | ---: | ---: | ---: | ---: |
| English | 186.362 | 0.880 | 0.404 | 0.070 |
| Mandarin | 155.053 | 0.548 | 0.234 | 0.039 |
| Cantonese | 161.448 | 0.577 | 0.140 | 0.032 |
| Japanese | 353.280 | 1.216 | 0.256 | 0.055 |
| Filipino (Tagalog) | 85.624 | 0.521 | 0.159 | 0.035 |
| French | 344.302 | 0.699 | 0.165 | 0.043 |
| German | 465.720 | 1.461 | 0.259 | 0.055 |

Cold worker timings include thread startup and index parsing. Warm lookups and prefix queries each use 100 requests over four or five known words. Prefix queries request up to eight results. OS caches were not cleared. The idle preload removes the cold cost only after it completes; an early lookup or a first visit to a lazy language can exceed 50 ms. A first multi-language lookup can also load non-preferred candidate packs.

The main-process store was measured separately after explicitly preloading all six packs, including checksum verification, which took 1,456.89 ms. These requests include path, stat, and manifest checks plus worker messaging; renderer IPC and rendering are excluded.

| Pack | Store first lookup after preload, ms | Store lookup p95, ms | Store prefix p95, ms |
| --- | ---: | ---: | ---: |
| English | 3.303 | 0.842 | 0.607 |
| Mandarin | 1.496 | 0.697 | 0.484 |
| Cantonese | 1.173 | 0.613 | 0.522 |
| Japanese | 0.409 | 1.001 | 0.849 |
| Filipino (Tagalog) | 0.382 | 0.473 | 0.354 |
| French | 0.381 | 0.743 | 0.432 |

Repeated mixed-language probes query every candidate pack for each term without unloading between calls. Each group ran 100 complete passes: 1,500 three-pack Latin lookups, 1,400 three-pack Han lookups, and 2,900 six-pack stress lookups. Their respective p95 times were 0.397, 0.500, and 0.676 ms per complete candidate lookup; maximum times were 4.436, 1.470, and 4.890 ms. The six-pack cache stayed resident. An earlier repeat observed a 29.8 ms outlier, so these measurements are not an every-request latency guarantee on a shared machine.

To repeat, save official source files as `en.xml.gz`, `zh.txt.gz`, `yue.zip`, `yue-readings.zip`, `ja.gz`, `tl.jsonl.gz`, and optionally `fr.jsonl.gz` or `de.jsonl.gz`. Legacy local `tl.jsonl` and `fr.jsonl` files remain accepted when their gzip equivalents are absent.

```sh
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results fr,yue
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results de
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results en,zh,yue,ja,tl,fr --all-six
```

The script records actual sizes, conversion counts, isolated retained memory, process RSS, cold/preloaded lookup times, prefix times, and mixed passes in `results.json`. It keeps converted packs through the mixed probes, then removes them. An optional `PACK_STORE_PROBE` script receives the converted pack paths and stats before cleanup for additional store measurements. Ordinary tests use only tiny attributed fixtures; Electron tests stub official downloads and reject online lookup requests.

## Known source limits

Kaikki marks the French, Tagalog, and German language-specific postprocessed feeds deprecated. They remain available at the verified URLs. The maintained all-language English Wiktionary extract was about 2.98 GB compressed and 25.6 GB expanded at verification, so it is not a practical direct replacement for these per-language downloads. A removed or substantially changed endpoint needs a catalog/converter update. The French edition's raw data has a different schema and gloss language.

The measured compressed French source transferred in 49.02 seconds and converted in 12.33 seconds. Rolling URLs may grow; displayed sizes are estimates from the verified snapshot. Users update manually from settings; English's versioned source advances with a future catalog update.

ponytail: local conversion keeps distribution on official publishers. If conversion becomes too slow on supported hardware, the upgrade path is separately licensed, attributed, versioned prebuilt packs hosted by a publisher or an explicitly chosen distributor. This implementation does not add that hosting.
