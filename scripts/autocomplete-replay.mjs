import { readdirSync, readFileSync } from 'node:fs'
import { createPersonalModel } from '../src/addons/autocomplete/model.ts'
import { rankWords } from '../src/addons/autocomplete/suggestions.ts'

const fixtureDirectory = new URL(
  '../tests/fixtures/autocomplete/',
  import.meta.url,
)
const topK = 3
function metrics() {
  return { topOneHits: 0, topKHits: 0, charactersSaved: 0, timings: [] }
}
function record(result, target, prefix, elapsed, metric) {
  metric.timings.push(elapsed)
  if (result[0]?.word === target) {
    metric.topOneHits++
    // One acceptance key; prefix has already been typed.
    metric.charactersSaved += Math.max(0, target.length - prefix.length - 1)
  }
  if (result.slice(0, topK).some((item) => item.word === target))
    metric.topKHits++
}
function summary(metric) {
  const timings = [...metric.timings].sort((a, b) => a - b)
  const samples = timings.length
  return {
    topOneHits: metric.topOneHits,
    acceptanceProxy: samples ? metric.topOneHits / samples : 0,
    topKHits: metric.topKHits,
    topKRelevance: samples ? metric.topKHits / samples : 0,
    charactersSaved: metric.charactersSaved,
    latency: {
      samples,
      meanMs: samples ? timings.reduce((a, b) => a + b) / samples : 0,
      p50Ms: timings[Math.floor(samples * 0.5)] ?? 0,
      p95Ms: timings[Math.floor(samples * 0.95)] ?? 0,
      maxMs: timings.at(-1) ?? 0,
    },
  }
}

const baseline = metrics()
const personal = metrics()
const corpora = []
const queries = {
  prefix: { baseline: metrics(), personal: metrics() },
  nextWord: { baseline: metrics(), personal: metrics() },
}
const feedback = {
  accepted: 0,
  undo: 0,
  overwrite: 0,
  ignored: 0,
  excludedSensitive: 0,
}
let typedCharacters = 0
// Warm only isolated throwaway data; evaluation models start empty.
const warm = createPersonalModel({ now: () => 1_000_000 })
const warmFound = [{ lang: 'en', words: ['prefix', 'prefer', 'present'] }]
warm.observe({ scope: null, languages: ['en'], kind: 'typed', word: 'prefix' })
for (let i = 0; i < 200; i++)
  warm.suggest({
    scope: null,
    languages: ['en'],
    prefix: 'pre',
    baseline: rankWords('pre', warmFound),
  })

for (const name of readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const corpus = JSON.parse(
    readFileSync(new URL(name, fixtureDirectory), 'utf8'),
  )
  let time = 1_000_000
  const model = createPersonalModel({ now: () => time })
  const corpusBaseline = metrics()
  const corpusPersonal = metrics()
  for (const event of corpus.events) {
    time += event.gapMs ?? 0
    for (let i = 0; i < (event.repeat ?? 1); i++) {
      time += 250
      const kind = event.kind ?? 'typed'
      const prefix = event.prefix ?? event.word.slice(0, 3)
      const target = event.expected ?? event.word
      const session = {
        scope: event.scope,
        languages: event.languages,
        context: event.context ?? [],
        sensitive: event.sensitive === true,
      }
      if (event.sensitive) feedback.excludedSensitive++
      else if (kind === 'typed' || kind === 'accepted') {
        // Fixture packs simulate the offline provider's prefix matches.
        const found = event.languages.map((lang) => ({
          lang,
          words: (corpus.dictionary[lang] ?? []).filter((word) =>
            word.toLowerCase().startsWith(prefix.toLowerCase()),
          ),
        }))
        const baselineStart = performance.now()
        // Existing dictionary pipeline offers no next-word predictions after a space.
        const ranked = prefix ? rankWords(prefix, found) : []
        const baselineElapsed = performance.now() - baselineStart
        const personalStart = performance.now()
        const suggested = model.suggest({
          ...session,
          prefix,
          baseline: ranked,
        })
        const personalElapsed = performance.now() - personalStart
        record(ranked, target, prefix, baselineElapsed, baseline)
        record(suggested, target, prefix, personalElapsed, personal)
        record(ranked, target, prefix, baselineElapsed, corpusBaseline)
        record(suggested, target, prefix, personalElapsed, corpusPersonal)
        const mode = prefix ? queries.prefix : queries.nextWord
        record(ranked, target, prefix, baselineElapsed, mode.baseline)
        record(suggested, target, prefix, personalElapsed, mode.personal)
        typedCharacters += target.length
      }
      if (Object.hasOwn(feedback, kind)) feedback[kind]++
      // Predict before observing; no future target enters the model.
      model.observe({ ...session, kind, word: event.word })
    }
  }
  corpora.push({
    name: corpus.name,
    description: corpus.description,
    samples: corpusPersonal.timings.length,
    baseline: summary(corpusBaseline),
    personal: summary(corpusPersonal),
    snapshotEntries: model.snapshot().entries.length,
  })
}

console.log(
  JSON.stringify(
    {
      samples: personal.timings.length,
      topK,
      typedCharacters,
      method:
        'chronological predict-before-learn replay from synthetic fixture packs; real rankWords baseline; exact-case top-1 acceptance proxy and top-3 relevance; saved characters subtract one acceptance key; performance.now timing after 200 isolated warmups',
      machine: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      baseline: summary(baseline),
      personal: summary(personal),
      feedback,
      queries: Object.fromEntries(
        Object.entries(queries).map(([kind, metric]) => [
          kind,
          {
            samples: metric.personal.timings.length,
            baseline: summary(metric.baseline),
            personal: summary(metric.personal),
          },
        ]),
      ),
      rankingBudgetMs: 5,
      meetsRankingBudget: summary(personal).latency.p95Ms < 5,
      corpora,
      limitations: [
        'Synthetic, small repeated corpus chosen to exercise learning; not evidence of real-world acceptance or generalization.',
        'Top-1 exact target match is an acceptance proxy, not observed suggestion acceptance.',
        'Reported undo and overwrite counts are fixture feedback, not predicted correction rates or insertion behavior.',
        'Latency measures in-process ranking only; pack retrieval, UI, persistence, and boundary observation costs are excluded.',
        'Personal latency is additional to baseline ranking; neither benchmark sends requests or loads user documents.',
        'Prefix candidates are bounded; a rare completion outside a bucket may be missed.',
        'Space queries have no baseline next-word predictions; prefix and next-word metrics are reported separately.',
        'Fixtures include short and non-Latin prefixes to exercise the model; UI prefix eligibility is not simulated.',
      ],
    },
    null,
    2,
  ),
)
