# Dictionary pack storage and measurements

The dictionary addon downloads official sources on request and converts them locally. Hibi neither bundles nor hosts dictionary data. See the [source catalog and licenses](../../../src/addons/dictionary/README.md#offline-dictionary-sources) and [user instructions](../../features/dictionary-packs.md).

## Installation and storage

The renderer sends a fixed language ID through the addon's native API. It cannot choose a URL, filename, or directory. Main validates that ID, downloads the catalog's HTTPS sources through the shared bounded download helper, and writes private staging files below `userData/dictionary-packs/`. Each request and redirect must retain that source's approved origin. The settings page shows approximate download sizes, publisher hosts, sources, and licenses before installation.

Download limits are separate for each source: WordNet and JMdict 32 MiB, CC-CEDICT 16 MiB, each Cantonese ZIP 8 MiB, Tagalog 256 MiB, and French 768 MiB. Streams enforce byte limits even without a Content-Length header. A 15-minute deadline covers downloading and conversion. Cancellation aborts the fetch or terminates the worker, waits for open handles to close, and removes staging files.

A Node worker thread recognizes gzip/ZIP headers and streams source records into `data.jsonl`. `index.json` stores sorted keys with byte offsets and lengths. Conversion accepts only the expected language format, rejects malformed or truncated records, bounds decompression and record counts, verifies ZIP CRCs through the existing archive helper, and never loads remote XML entities. Source archives are deleted after successful conversion.

The manifest records language, format version, installation date, source URLs, source version/date headers, licenses, download sizes and SHA-256 hashes, entry/key counts, conversion time, and output sizes/hashes. SHA-256 detects incomplete or changed local files; it is not a publisher signature. Source authenticity relies on the fixed official HTTPS origins.

A complete new pack replaces the old directory by rename. The old directory remains available for rollback if replacement fails; startup recovers an interrupted replacement and removes unfinished staging downloads. Failed or canceled updates preserve the installed pack. Uninstall unloads the worker's index and removes the pack. Disabling the addon stops active work but retains installed packs.

The store serializes mutations and suppresses lookups during installation or removal. Concurrent initial lookups share one checksum verification. Generation checks stop stale verification from reopening a pack during mutation or shutdown. Lookup availability resumes when the operation finishes.

## Lookup and bounds

Only one language's index and file handle stay loaded at a time. The worker returns bounded entry records; the renderer receives no paths. Exact keys win before normalized keys. English also uses the WordNet XML's 4,473 explicit inflected forms, including irregular forms such as `went`, `children`, and `mice`, then conservative suffix candidates that must exist in the index. Hibi does not download the separate WNDB exception archive. Chinese connects traditional/simplified pairs from the dictionaries; Japanese connects JMdict kanji and kana forms. Tagalog and French add lowercase matching.

The worker has a 512 MiB old-generation heap limit. Conversion caps are one million entries, 750,000 keys, 1.5 million references, 512 MiB of entry data, and 48 MiB of index data. Each packed record is at most 64 KiB. Source decompression is capped at 512 MiB, except French's 768 MiB; source records are capped at 2 MiB. The runtime admits at most 64 queued jobs. Each lookup returns at most 32 records and 512 KiB. Directory/file checks reject symlinks; the loader validates ordering, offsets, record boundaries, and key membership.

The registry checks installed providers across all candidate languages before trying any online provider. A local answer therefore makes zero online lookup requests. CC-CEDICT, CC-Canto, and JMdict do not provide a broad thesaurus. English uses WordNet relations; Tagalog and French keep Wiktionary synonym/antonym fields. Other thesaurus results depend on source coverage and online fallback.

## Full-source measurements

Measured on 12 October 2026 with an Apple M2, 24 GiB memory, macOS, Node 24.11.0, and the production worker pipeline. All six complete upstream sources converted and answered the benchmark words within existing bounds. Bytes are exact; conversion times exclude downloading. Installed bytes below combine `data.jsonl` and `index.json` and exclude the small manifest.

| Pack | Download bytes | Installed bytes | Entries | Conversion seconds |
| --- | ---: | ---: | ---: | ---: |
| English | 11,363,503 | 52,067,519 | 135,969 | 9.01 |
| Mandarin | 3,980,329 | 35,540,839 | 125,262 | 3.15 |
| Cantonese, three sources | 7,136,893 | 38,015,289 | 133,052 | 41.83 |
| Japanese | 10,583,340 | 89,520,006 | 218,888 | 9.00 |
| Filipino (Tagalog) | 130,506,107 | 11,863,308 | 40,397 | 1.70 |
| French | 583,677,104 | 103,526,457 | 403,165 | 13.98 |

| Pack | First lookup including index load, ms | Uncached word after load, ms | Warm p50, ms | Warm p95, ms |
| --- | ---: | ---: | ---: | ---: |
| English | 392.02 | 3.060 | 0.129 | 0.478 |
| Mandarin | 463.79 | 0.308 | 0.147 | 0.259 |
| Cantonese | 897.75 | 0.958 | 0.159 | 0.582 |
| Japanese | 656.93 | 0.116 | 0.076 | 0.141 |
| Filipino (Tagalog) | 41.10 | 0.175 | 0.086 | 0.165 |
| French | 588.49 | 0.300 | 0.132 | 0.289 |

Each warm measurement uses 100 worker requests across four or five known words. The uncached-word sample follows index loading; OS caches were not cleared. Times include the worker message round trip, not renderer IPC, main-process checksum verification, or network latency. Initial loading therefore costs more than the target of 50 ms for a word lookup after load. Switching languages reloads the index. English conversion peaked around 437–456 MiB RSS in separate source probes; the heap limit does not cap total process RSS.

These measurements came from completed runs on a shared machine. A separate English run during simultaneous builds/typechecks took 66.7 seconds to convert, 7.73 seconds to load, and reached 51.1 ms warm p95. Load and conversion times vary with contention; these samples are not a latency guarantee. Cantonese's reported conversion also ran under contention.

To repeat without downloading during tests, save official source files under these names: `en.xml.gz`, `zh.txt.gz`, `yue.zip`, `yue-readings.zip`, `ja.gz`, `tl.jsonl`, and optionally `fr.jsonl`. Then run from the repository root:

```sh
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results
# Optional third argument selects languages, for example:
node scripts/bench-dictionary-packs.mjs /path/to/sources /path/to/results fr,yue
```

The script records actual source sizes, conversion/output counts and sizes, and lookup times in `results.json`. It removes converted benchmark packs after each language. Ordinary converter/store/worker tests use only the tiny attributed fixtures in `tests/fixtures/dictionary-packs/`; Electron tests stub official downloads and reject online lookup requests.

## Known source limits

Kaikki marks both language-specific postprocessed feeds deprecated. They remain available at the verified URLs. The maintained all-language English Wiktionary extract was about 2.98 GB compressed and 25.6 GB expanded at verification, so it is not a practical direct replacement for these per-language downloads. A removed or substantially changed endpoint needs a catalog/converter update. The French edition's raw data has a different schema and gloss language.

Downloads can dominate installation: the measured French source transfer took about 500 seconds, while conversion took 14 seconds. Rolling URLs may grow; displayed sizes are estimates from the verified snapshot. Users update manually from settings; English's versioned source advances with a future catalog update.

ponytail: local conversion keeps distribution on official publishers. If conversion becomes too slow on supported hardware, the upgrade path is separately licensed, attributed, versioned prebuilt packs hosted by a publisher or an explicitly chosen distributor. This implementation does not add that hosting.
