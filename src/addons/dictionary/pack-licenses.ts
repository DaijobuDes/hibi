export const packLicenses = [
  {
    id: 'dictionary-french-wiktionary',
    name: 'French Wiktionary / Kaikki',
    license: 'CC BY-SA 4.0 / GFDL 1.1 or later',
    text: `French dictionary text by Wiktionary contributors, extracted by Wiktextract and distributed by Kaikki.org.
Source: https://kaikki.org/dictionary/French/
Original entries and contributor histories: https://en.wiktionary.org/
Copyright statement: https://en.wiktionary.org/wiki/Wiktionary:Copyrights
CC license: https://creativecommons.org/licenses/by-sa/4.0/
CC license text: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
Alternative GFDL licence: https://www.gnu.org/licenses/old-licenses/fdl-1.1.html
Hibi uses the CC BY-SA 4.0 option for this text.
Changes: Hibi converts the French JSON Lines extract into an offline lookup index, retaining definitions, forms and lexical relations.
The extraction observed during verification was produced on 2026-10-03 from the English Wiktionary dump dated 2026-09-02. Installed download metadata identifies each fetched snapshot.`,
  },
  {
    id: 'dictionary-oewn',
    name: 'Open English WordNet',
    license: 'CC BY 4.0 and Princeton WordNet notices',
    text: `Open English WordNet 2025
Copyright (c) 2019-present, The Open English WordNet Team.
Derived from Princeton University WordNet. Attribution is given to both Princeton WordNet and the Open English WordNet team.
Source: https://en-word.net/
License: https://creativecommons.org/licenses/by/4.0/
License text: https://creativecommons.org/licenses/by/4.0/legalcode.en
Upstream notices: https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md
Princeton notice: https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt
Changes: Hibi converts the upstream XML into an offline lookup index, retaining definitions, forms and lexical relations.

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.`,
  },
  {
    id: 'dictionary-cc-cedict',
    name: 'CC-CEDICT',
    license: 'CC BY-SA 4.0',
    text: `CC-CEDICT is maintained by the CC-CEDICT community and published by MDBG.
Referenced work: CEDICT, Copyright (c) 1997, 1998 Paul Andrew Denisowski.
Source: https://www.mdbg.net/chinese/dictionary?page=cedict
License: https://creativecommons.org/licenses/by-sa/4.0/
License text: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
Changes: Hibi converts the upstream text into an offline lookup index. The Cantonese pack combines these definitions with separately attributed Cantonese readings.`,
  },
  {
    id: 'dictionary-cc-canto',
    name: 'CC-Canto',
    license: 'CC BY-SA 3.0',
    text: `CC-Canto, version 2017-02-02.
Copyright (c) 2015-17 Pleco Inc.
Source: https://cantonese.org/download.html
License: https://creativecommons.org/licenses/by-sa/3.0/
License text: https://creativecommons.org/licenses/by-sa/3.0/legalcode.en
Changes: Hibi converts the upstream text into an offline Cantonese lookup index and combines it with separately attributed CC-CEDICT data.`,
  },
  {
    id: 'dictionary-cc-cedict-cantonese-readings',
    name: 'CC-CEDICT Cantonese Readings',
    license: 'CC BY-SA 3.0',
    text: `CC-CEDICT Cantonese Readings, version 2015-09-23.
Copyright (c) 2015 Pleco Software Incorporated.
Source: https://cantonese.org/download.html
License: https://creativecommons.org/licenses/by-sa/3.0/
License text: https://creativecommons.org/licenses/by-sa/3.0/legalcode.en
Changes: Hibi joins the upstream Cantonese readings to separately attributed CC-CEDICT definitions and indexes the resulting entries for offline lookup.`,
  },
  {
    id: 'dictionary-jmdict',
    name: 'JMdict / EDRDG',
    license: 'CC BY-SA 4.0',
    text: `JMdict is copyright James William Breen and the Electronic Dictionary Research and Development Group.
Source: https://www.edrdg.org/jmdict/j_jmdict.html
Upstream licence statement: https://www.edrdg.org/edrdg/licence.html
License: https://creativecommons.org/licenses/by-sa/4.0/
License text: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
Changes: Hibi converts the English-gloss JMdict_e XML into an offline lookup index with Japanese spellings and readings.
The upstream licence statement requires appropriate acknowledgement and a procedure for regular dictionary updates.`,
  },
  {
    id: 'dictionary-tagalog-wiktionary',
    name: 'Tagalog Wiktionary / Kaikki',
    license: 'CC BY-SA 4.0 / GFDL 1.1 or later',
    text: `Tagalog dictionary text by Wiktionary contributors, extracted by Wiktextract and distributed by Kaikki.org.
Source: https://kaikki.org/dictionary/Tagalog/
Original entries and contributor histories: https://en.wiktionary.org/
Copyright statement: https://en.wiktionary.org/wiki/Wiktionary:Copyrights
CC license: https://creativecommons.org/licenses/by-sa/4.0/
CC license text: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
Alternative GFDL licence: https://www.gnu.org/licenses/old-licenses/fdl-1.1.html
Wiktionary states GFDL version 1.1 or later, with no invariant sections or cover texts.
Hibi uses the CC BY-SA 4.0 option for this text.
Changes: Hibi converts the Tagalog JSON Lines extract into an offline lookup index, retaining definitions, forms and lexical relations.
The extraction observed during source verification was produced on 2026-10-03 from the English Wiktionary dump dated 2026-09-02. Installed download metadata identifies each fetched snapshot.`,
  },
]
