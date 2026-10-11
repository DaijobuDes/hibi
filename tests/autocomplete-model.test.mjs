import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { createPersonalModel } from '../src/addons/autocomplete/model.ts'
import { rankWords } from '../src/addons/autocomplete/suggestions.ts'

const DAY = 86_400_000
const session = { scope: 'notes', languages: ['en'] }
const baseline = rankWords('cra', [
  { lang: 'en', words: ['crack', 'crazy', 'crayon', 'crayfish'] },
])
const query = { ...session, prefix: 'cra', baseline }
const words = (model, request = query) =>
  model.suggest(request).map((item) => item.word)
function learn(model, word, count = 1, extra = {}) {
  for (let i = 0; i < count; i++)
    model.observe({ ...session, kind: 'typed', word, ...extra })
}
function clock() {
  let time = 1_000_000
  return {
    now: () => time,
    advance: (ms) => {
      time += ms
    },
  }
}

test('cold start preserves actual dictionary order, phrases, languages and case', () => {
  const model = createPersonalModel()
  const ranked = rankWords('hap', [
    {
      lang: 'en',
      words: ['happy hour', 'Hapsburg', 'happiness', 'happy', 'haply'],
    },
    { lang: 'fr', words: ['hapax', 'happy'] },
  ])
  assert.deepEqual(
    words(model, {
      ...session,
      languages: ['en', 'fr'],
      prefix: 'hap',
      baseline: ranked,
    }),
    ranked.map((item) => item.word),
  )
  assert.deepEqual(
    words(model),
    baseline.map((item) => item.word),
  )
  assert.deepEqual(model.snapshot(), { version: 1, entries: [] })
})

test('custom vocabulary outranks ordinary baseline, strong history outranks custom', () => {
  const model = createPersonalModel()
  const request = {
    ...query,
    baseline: [...baseline, { word: 'craycray', lang: 'en', custom: true }],
  }
  assert.equal(words(model, request)[0], 'craycray')
  learn(model, 'crayzee', 80)
  assert.equal(words(model, request)[0], 'crayzee')
  assert.equal(words(model, { ...request, enabled: false })[0], 'craycray')
})

test('custom priority is retained when an offline pack contains the same word', () => {
  const model = createPersonalModel()
  const request = {
    ...query,
    baseline: [...baseline, { word: 'crayfish', lang: 'en', custom: true }],
  }
  assert.equal(words(model, request)[0], 'crayfish')
  assert.equal(words(model, { ...request, enabled: false })[0], 'crayfish')
  assert.equal(
    words(model, request).filter((word) => word === 'crayfish').length,
    1,
  )
})

test('repetition promotes personal vocabulary and existing dictionary words', () => {
  const model = createPersonalModel()
  learn(model, 'craycray', 40)
  assert.equal(words(model)[0], 'craycray')
  const other = createPersonalModel()
  learn(other, 'crayfish', 30)
  assert.equal(words(other)[0], 'crayfish')
})

test('one typed or accepted observation cannot overwhelm strongest cold baseline', () => {
  for (const kind of ['typed', 'accepted']) {
    const model = createPersonalModel({ now: () => 1_000_000 })
    learn(model, 'craycray', 1, { kind, context: ['that', 'was'] })
    assert.equal(
      words(model, { ...query, context: ['that', 'was'] })[0],
      baseline[0].word,
    )
    assert.ok(words(model).includes('craycray'))
    const existing = createPersonalModel({ now: () => 1_000_000 })
    learn(existing, baseline[1].word, 1, { kind, context: ['that', 'was'] })
    assert.equal(
      words(existing, { ...query, context: ['that', 'was'] })[0],
      baseline[0].word,
    )
  }
})

test('bigram and trigram patterns predict next word after a space', () => {
  const model = createPersonalModel()
  learn(model, 'crazy', 70)
  learn(model, 'wild', 25, { context: ['bro', 'that', 'was'] })
  learn(model, 'weird', 25, { context: ['it', 'was'] })
  assert.equal(
    words(model, { ...session, prefix: '', context: ['that', 'was'] })[0],
    'wild',
  )
  assert.equal(
    words(model, { ...session, prefix: '', context: ['it', 'was'] })[0],
    'weird',
  )
  assert.ok(model.snapshot().entries.some((row) => row.context.length === 1))
  assert.ok(model.snapshot().entries.every((row) => row.context.length <= 2))
})

test('slang, spelling, capitalization and multilingual scripts remain exact', () => {
  const model = createPersonalModel()
  for (const word of [
    'NaMe',
    'name',
    'NAME',
    'l’éco',
    'broooo',
    `bro${'o'.repeat(40)}`,
    'antidisestablishmentarianism',
    'kumustaaa',
    '你好',
    'こんにちは',
    'café',
    'co-operate',
  ])
    learn(model, word, 5, { languages: ['en', 'tl', 'zh', 'ja', 'fr'] })
  learn(model, 'NaMe', 20, { languages: ['en', 'tl', 'zh', 'ja', 'fr'] })
  const request = {
    ...session,
    languages: ['en', 'tl', 'zh', 'ja', 'fr'],
    prefix: 'na',
  }
  assert.equal(words(model, request)[0], 'NaMe')
  assert.deepEqual(
    new Set(words(model, request)),
    new Set(['NaMe', 'name', 'NAME']),
  )
  assert.equal(words(model, { ...request, prefix: '你' })[0], '你好')
  assert.equal(words(model, { ...request, prefix: 'こん' })[0], 'こんにちは')
  assert.equal(words(model, { ...request, prefix: 'kum' })[0], 'kumustaaa')
  assert.equal(words(model, { ...request, prefix: 'l’é' })[0], 'l’éco')
  assert.ok(
    words(model, { ...request, prefix: 'bro' }).includes(
      `bro${'o'.repeat(40)}`,
    ),
  )
  assert.equal(
    words(model, { ...request, prefix: 'anti' })[0],
    'antidisestablishmentarianism',
  )
})

test('session language sets filter membership without guessing word language', () => {
  const model = createPersonalModel()
  learn(model, 'kumusta', 20, { languages: ['tl', 'en'] })
  learn(model, '你好', 20, { languages: ['en'] })
  assert.equal(
    words(model, { ...session, languages: ['tl'], prefix: 'kum' })[0],
    'kumusta',
  )
  assert.deepEqual(
    words(model, { ...session, languages: ['fr'], prefix: 'kum' }),
    [],
  )
  assert.deepEqual(
    words(model, { ...session, languages: ['zh'], prefix: '你' }),
    [],
  )
  assert.equal(words(model, { ...session, prefix: '你' })[0], '你好')
  const snapshot = model.snapshot()
  assert.deepEqual(
    snapshot.entries.find((row) => row.word === 'kumusta').languages,
    ['en', 'tl'],
  )
})

test('overlapping session language sets do not double-count confidence', () => {
  const model = createPersonalModel({ now: () => 1_000_000 })
  learn(model, 'craycray', 3, { languages: ['en', 'tl'] })
  const one = model
    .suggest(query)
    .find((item) => item.word === 'craycray').score
  const mixed = model
    .suggest({ ...query, languages: ['en', 'tl'] })
    .find((item) => item.word === 'craycray').score
  assert.equal(one, mixed)
  learn(model, 'craycray', 3, { languages: ['en'] })
  assert.equal(
    model.suggest(query).find((item) => item.word === 'craycray').score,
    one,
  )
})

test('acceptance boosts evidence; ignored suggestions produce no signal', () => {
  const model = createPersonalModel({ now: () => 1_000_000 })
  learn(model, 'craycray')
  const typed = model
    .suggest(query)
    .find((item) => item.word === 'craycray').score
  learn(model, 'craycray', 1, { kind: 'accepted' })
  const boosted = model
    .suggest(query)
    .find((item) => item.word === 'craycray').score
  assert.ok(boosted > typed)
  const before = model.snapshot()
  learn(model, 'craycray', 50, { kind: 'ignored' })
  assert.equal(model.snapshot().entries[0].count, before.entries[0].count)
})

test('immediate undo and overwrite roll back accept boost and penalize repeated mistakes', () => {
  for (const kind of ['undo', 'overwrite']) {
    const timer = clock()
    const model = createPersonalModel({ now: timer.now })
    learn(model, 'crayfish', 30)
    assert.equal(words(model)[0], 'crayfish')
    for (let i = 0; i < 8; i++) {
      learn(model, 'crayfish', 1, { kind: 'accepted' })
      timer.advance(100)
      learn(model, 'crayfish', 1, { kind })
    }
    assert.equal(words(model)[0], baseline[0].word)
    const row = model.snapshot().entries[0]
    assert.ok(Math.abs(row.count - 30) < 0.001)
    assert.ok(row.corrections > 7.99)
    const saved = model.snapshot()
    learn(model, 'crayfish', 1, { kind })
    assert.deepEqual(model.snapshot(), saved)
  }
})

test('corrections affect comparable context; late and unrelated edits have no penalty', () => {
  const timer = clock()
  const model = createPersonalModel({ now: timer.now })
  learn(model, 'wild', 20, { context: ['that', 'was'] })
  learn(model, 'wild', 20, { context: ['work', 'is'] })
  const unrelated = { ...session, prefix: '', context: ['work', 'is'] }
  const score = model.suggest(unrelated)[0].score
  learn(model, 'wild', 1, { kind: 'accepted', context: ['that', 'was'] })
  learn(model, 'wild', 1, { kind: 'undo', context: ['that', 'was'] })
  assert.equal(model.suggest(unrelated)[0].score, score)
  assert.equal(
    model.snapshot().entries.find((row) => row.context.join(' ') === 'that was')
      .corrections,
    1,
  )
  learn(model, 'wild', 1, { kind: 'accepted' })
  timer.advance(10_001)
  learn(model, 'wild', 1, { kind: 'overwrite' })
  assert.equal(
    model.snapshot().entries.find((row) => !row.context.length).corrections,
    0,
  )
})

test('decay allows recent habits to replace older preferences and prunes stale data', () => {
  const timer = clock()
  const model = createPersonalModel({ now: timer.now })
  learn(model, 'craycray', 80)
  assert.equal(words(model)[0], 'craycray')
  timer.advance(300 * DAY)
  assert.equal(words(model)[0], baseline[0].word)
  learn(model, 'crazee', 40)
  assert.equal(words(model)[0], 'crazee')
  timer.advance(1000 * DAY)
  assert.deepEqual(model.snapshot().entries, [])
})

test('workspace, outside-workspace global scope and separate profile instances never pool', () => {
  const model = createPersonalModel()
  learn(model, 'craycray', 40)
  learn(model, 'crazee', 40, { scope: null })
  assert.equal(words(model)[0], 'craycray')
  assert.equal(words(model, { ...query, scope: null })[0], 'crazee')
  assert.deepEqual(
    words(model, { ...query, scope: 'other' }),
    baseline.map((item) => item.word),
  )
  assert.deepEqual(
    words(createPersonalModel()),
    baseline.map((item) => item.word),
  )
})

test('sensitive fields and disabled learning store nothing; disabled ranking uses baseline', () => {
  const model = createPersonalModel()
  learn(model, 'craycray', 20, { sensitive: true })
  learn(model, 'craycray', 20, { enabled: false })
  assert.deepEqual(model.snapshot().entries, [])
  learn(model, 'craycray', 40)
  assert.deepEqual(
    words(model, { ...query, enabled: false }),
    baseline.map((item) => item.word),
  )
  assert.deepEqual(words(model, { ...query, sensitive: true }), [])
  assert.ok(model.snapshot().entries.length > 0)
})

test('secret-like words and excluded context tokens never persist', () => {
  const model = createPersonalModel()
  const excluded = [
    'sk-privatevalue',
    'ghp_example',
    '123456',
    '1234-5678-9012-3456',
    'a@b.example',
    'https://secret.example',
    'deadbeefdeadbeef',
    'eyJhbGciOiJIUzIoneJhbGciOiJIUzI',
    'word/sensitive',
    'x'.repeat(65),
    'two words',
    'line\nbreak',
    'api_key=value',
  ]
  for (const word of excluded) learn(model, word, 3)
  assert.deepEqual(model.snapshot().entries, [])
  learn(model, 'okay', 3, { context: ['secret@example.test', 'safe'] })
  assert.ok(
    model.snapshot().entries.some((row) => row.context.join(' ') === 'safe'),
  )
  const json = JSON.stringify(model.snapshot())
  for (const secret of excluded) assert.ok(!json.includes(secret))
  assert.ok(!json.includes('secret@example.test'))
  assert.deepEqual(words(model, { ...session, prefix: 'sk-' }), [])
})

test('clearing one scope, global scope or all scopes removes vocabulary and correction state', () => {
  const model = createPersonalModel()
  learn(model, 'craycray', 10)
  learn(model, 'crazee', 40, { scope: null })
  learn(model, 'crabro', 10, { scope: 'inactive' })
  model.clear('notes')
  learn(model, 'craycray', 1, { kind: 'undo' })
  assert.deepEqual(
    words(model),
    baseline.map((item) => item.word),
  )
  assert.equal(words(model, { ...query, scope: null })[0], 'crazee')
  model.clear(null)
  assert.deepEqual(
    words(model, { ...query, scope: null }),
    baseline.map((item) => item.word),
  )
  assert.ok(model.snapshot().entries.some((row) => row.scope === 'inactive'))
  model.clear()
  assert.deepEqual(model.snapshot(), { version: 1, entries: [] })
})

test('snapshots round-trip exact bounded aggregate data without sharing mutable references', () => {
  const timer = clock()
  const model = createPersonalModel({ now: timer.now })
  learn(model, 'CrayBro', 20, {
    context: ['bro', 'that', 'was'],
    languages: ['tl', 'en'],
  })
  learn(model, 'craycray', 1, { kind: 'accepted' })
  learn(model, 'craycray', 1, { kind: 'undo' })
  timer.advance(DAY)
  const saved = model.snapshot()
  const copy = createPersonalModel({
    now: timer.now,
    snapshot: JSON.parse(JSON.stringify(saved)),
  })
  assert.deepEqual(copy.snapshot(), saved)
  assert.deepEqual(copy.suggest(query), model.suggest(query))
  saved.entries[0].word = 'mutated'
  saved.entries[0].languages.length = 0
  saved.entries[0].context.push('leak')
  assert.ok(!JSON.stringify(model.snapshot()).includes('mutated'))
  assert.ok(!JSON.stringify(model.snapshot()).includes('leak'))
})

test('invalid, excessive and newer-version snapshots are ignored without throwing', () => {
  const timer = clock()
  const model = createPersonalModel({ now: timer.now })
  learn(model, 'crazy')
  const good = model.snapshot().entries[0]
  for (const snapshot of [
    null,
    [],
    {},
    { version: 2, entries: [good] },
    { version: 1, entries: 'invalid' },
    { version: 1, entries: Array(8193).fill(good) },
  ])
    assert.deepEqual(
      createPersonalModel({ snapshot, now: timer.now }).snapshot().entries,
      [],
    )
  const corrupt = [
    { word: 'sk_abc' },
    { scope: '' },
    { scope: 1 },
    { languages: ['xx'] },
    { languages: ['en', 'en'] },
    { languages: [] },
    { context: ['one', 'two', 'three'] },
    { context: ['secret@example.test'] },
    { count: NaN },
    { count: Infinity },
    { count: -1 },
    { count: 1_000_001 },
    { corrections: '1' },
    { corrections: -1 },
    { updatedAt: timer.now() + 1 },
    { lastUsed: timer.now() + 1 },
    { updatedAt: -1 },
  ].map((bad) => ({ ...good, ...bad }))
  const copy = createPersonalModel({
    now: timer.now,
    snapshot: {
      version: 1,
      entries: [null, ...corrupt, { ...good, extra: 'private sentence' }, good],
    },
  })
  assert.deepEqual(copy.snapshot().entries, [good])
})

test('entry and scope caps prune while keeping strong evidence', () => {
  const timer = clock()
  const model = createPersonalModel({ now: timer.now, maxEntries: 48 })
  learn(model, 'craycray', 80)
  for (let i = 0; i < 100; i++) {
    timer.advance(1)
    learn(
      model,
      'word' +
        String.fromCharCode(65 + (i % 26)) +
        String.fromCharCode(65 + Math.floor(i / 26)),
      1,
      { context: ['that', 'was'] },
    )
  }
  assert.ok(model.snapshot().entries.length <= 48)
  assert.equal(words(model)[0], 'craycray')
  const many = createPersonalModel({ now: timer.now })
  for (let i = 0; i < 25; i++) {
    timer.advance(1)
    learn(many, 'term', 1, { scope: `workspace-${i}` })
  }
  assert.equal(
    new Set(many.snapshot().entries.map((row) => row.scope)).size,
    16,
  )
})

test('rapid requests are synchronous, independent and cannot publish stale results', () => {
  const model = createPersonalModel()
  learn(model, 'craycray', 40)
  const first = model.suggest(query)
  const second = model.suggest({ ...query, prefix: 'crayc', baseline: [] })
  assert.ok(!(first instanceof Promise))
  assert.deepEqual(
    second.map((item) => item.word),
    ['craycray'],
  )
  first[0].word = 'changed'
  assert.equal(words(model)[0], 'craycray')
  assert.deepEqual(words(model, { ...query, prefix: 'absent' }), [])
  assert.deepEqual(words(model, { ...query, limit: 0 }), [])
})

test('bounded common-prefix ranking stays below 5ms at maximum snapshot size', (t) => {
  const timer = clock()
  const entry = (i) => ({
    scope: 'notes',
    languages: ['en', 'tl', 'fr', 'ja', 'zh', 'yue'],
    context: [[], ['that'], ['bro', 'that']][i % 3],
    word:
      'prefix' +
      String.fromCharCode(65 + (i % 26)) +
      String.fromCharCode(65 + (Math.floor(i / 26) % 26)) +
      String.fromCharCode(65 + Math.floor(i / 676)),
    count: 1 + (i % 50),
    corrections: 0,
    updatedAt: timer.now(),
    lastUsed: timer.now(),
  })
  const model = createPersonalModel({
    now: timer.now,
    maxEntries: 8192,
    snapshot: {
      version: 1,
      entries: Array.from({ length: 8192 }, (_, i) => entry(i)),
    },
  })
  assert.equal(model.snapshot().entries.length, 8192)
  const request = {
    ...session,
    languages: ['en', 'tl', 'fr', 'ja', 'zh', 'yue'],
    prefix: 'pre',
    context: ['bro', 'that'],
  }
  for (let i = 0; i < 100; i++) model.suggest(request)
  const timings = []
  for (let i = 0; i < 500; i++) {
    const start = performance.now()
    model.suggest(request)
    timings.push(performance.now() - start)
  }
  timings.sort((a, b) => a - b)
  t.diagnostic(
    JSON.stringify({
      samples: timings.length,
      p95Ms: timings[Math.floor(timings.length * 0.95)],
      meanMs: timings.reduce((a, b) => a + b) / timings.length,
      maxMs: timings.at(-1),
    }),
  )
  assert.ok(
    timings[Math.floor(timings.length * 0.95)] < 5,
    'p95 ranking must be below 5ms',
  )
  assert.ok(
    timings.reduce((a, b) => a + b) / timings.length < 5,
    'mean ranking must be below 5ms',
  )
})

test('offline replay reports real sample sizes, baseline ranking and measured metrics', () => {
  const report = JSON.parse(
    execFileSync(process.execPath, ['scripts/autocomplete-replay.mjs'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    }),
  )
  assert.ok(report.samples > 50)
  assert.equal(report.corpora.length, 3)
  assert.ok(report.method.includes('rankWords'))
  assert.ok(report.limitations.length > 0)
  assert.ok(report.personal.topKHits >= report.baseline.topKHits)
  assert.ok(report.personal.charactersSaved >= report.baseline.charactersSaved)
  assert.equal(report.personal.latency.samples, report.samples)
  assert.ok(report.personal.latency.p95Ms < 5)
})
