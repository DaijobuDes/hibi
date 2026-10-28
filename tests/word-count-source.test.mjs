import assert from 'node:assert/strict'
import test from 'node:test'
import { countText } from '../src/addons/word-count/count.ts'
import { SourceCounter } from '../src/addons/word-count/source-counter.ts'
import { SourceStore } from '../src/shared/source-buffer.ts'

function read(counter) {
  const work = counter.read()
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
  }
}
function edit(counter, changes) {
  const source = counter.store.snapshot()
  const prepared = counter.store.prepare({
    document: source.document,
    operationId: crypto.randomUUID(),
    baseVersion: source.version,
    contentVersion: source.version + 1,
    origin: 'source',
    historyGroup: 'raw-count',
    changes,
  })
  counter.apply(prepared)
  counter.store.commit(prepared)
}
for (const source of [
  '',
  '# café 👨‍👩‍👧‍👦\n\n中文',
  '**literal** [link](https://example.com/a)\r\n\r\nlast',
  'carriage\r\n👩🏽‍💻 é 🇵🇭',
  `${'a '.repeat(4095)}👩🏽‍💻\r\n${'word '.repeat(900)}`,
]) {
  test(`source counts retain raw syntax and unicode: ${JSON.stringify(source.slice(0, 80))}`, () => {
    const counter = new SourceCounter(
      new SourceStore(source, { tabId: 'raw', revision: 0 }),
    )
    assert.deepEqual(read(counter), countText(source))
    for (const changes of [
      [{ from: 0, to: 0, insert: '# **x**\n' }],
      [
        { from: 0, to: 2, insert: '\r\n' },
        { from: 4, to: 4, insert: 'é ' },
      ],
    ]) {
      const snapshot = counter.store.snapshot()
      const before = snapshot.sliceRaw(0, snapshot.utf16Length)
      edit(counter, changes)
      let after = before
      for (const change of changes.toReversed())
        after =
          after.slice(0, change.from) + change.insert + after.slice(change.to)
      assert.deepEqual(read(counter), countText(after))
    }
  })
}

test('source counts keep a batch of local edits bounded in 50 mib', (t) => {
  const size = 50 * 1024 * 1024
  const counter = new SourceCounter(
    new SourceStore('ordinary words. '.repeat(size / 16), {
      tabId: 'raw-scale',
      revision: 0,
    }),
  )
  const initial = read(counter)
  assert.deepEqual(initial, { words: (size / 16) * 2, characters: size })
  counter.counters(true)
  counter.store.counters(true)
  edit(
    counter,
    [19, size / 2 + 3, size - 13].map((from) => ({
      from,
      to: from,
      insert: ' x ',
    })),
  )
  assert.deepEqual(read(counter), {
    words: initial.words + 6,
    characters: initial.characters + 9,
  })
  const work = { ...counter.counters(), source: counter.store.counters() }
  assert.ok(work.countedUnits < 4096, JSON.stringify(work))
  assert.ok(work.source.sourceUnitsRead < 4096, JSON.stringify(work))
  assert.equal(work.source.materializations, 0)
  t.diagnostic(JSON.stringify(work))
})

for (const ending of ['\n', '\r\n', '\r'])
  test(`source counts bound cjk paragraph bursts with ${JSON.stringify(ending)}`, (t) => {
    let source = `${'中文'.repeat(100)}${ending.repeat(2)}`.repeat(1300)
    const counter = new SourceCounter(
      new SourceStore(source, { tabId: 'cjk-burst', revision: 0 }),
    )
    assert.deepEqual(read(counter), countText(source))
    const receipts = []
    for (let version = 1; version <= 5; version++) {
      counter.counters(true)
      counter.store.counters(true)
      edit(counter, [{ from: 101, to: 101, insert: '中' }])
      source = `${source.slice(0, 101)}中${source.slice(101)}`
      const work = { ...counter.counters(), source: counter.store.counters() }
      receipts.push({ version, ...work })
      assert.ok(
        work.countedUnits > 0 && work.countedUnits < 1024,
        JSON.stringify(work),
      )
      assert.ok(work.source.sourceUnitsRead < 4096, JSON.stringify(work))
      assert.equal(work.source.materializations, 0)
      assert.equal(work.source.materializedUnits, 0)
    }
    assert.deepEqual(read(counter), countText(source))
    t.diagnostic(JSON.stringify({ ending, receipts }))
  })

test('source counts defer unbounded segmentation until a requested read', (t) => {
  let source = '中文'.repeat(16 * 1024)
  const counter = new SourceCounter(
    new SourceStore(source, { tabId: 'source-deferred', revision: 0 }),
  )
  assert.deepEqual(read(counter), countText(source))
  const segment = Intl.Segmenter.prototype.segment
  const lengths = []
  t.mock.method(Intl.Segmenter.prototype, 'segment', function (input) {
    lengths.push(input.length)
    return segment.call(this, input)
  })
  const receipts = []
  for (let version = 1; version <= 5; version++) {
    lengths.length = 0
    counter.counters(true)
    counter.store.counters(true)
    edit(counter, [{ from: 101, to: 101, insert: '中' }])
    source = `${source.slice(0, 101)}中${source.slice(101)}`
    const work = { ...counter.counters(), source: counter.store.counters() }
    receipts.push({ version, ...work })
    assert.deepEqual(lengths, [], 'editing must defer nonlocal segmentation')
    assert.equal(work.countedUnits, 0)
    assert.ok(work.source.sourceUnitsRead < 20000, JSON.stringify(work))
    assert.equal(work.source.materializations, 0)
  }
  const cancelled = counter.read()
  assert.equal(cancelled.next().done, false)
  cancelled.return()
  lengths.length = 0
  edit(counter, [{ from: 101, to: 101, insert: '中' }])
  source = `${source.slice(0, 101)}中${source.slice(101)}`
  assert.deepEqual(
    lengths,
    [],
    'cancelled counts must not restore stale totals',
  )
  assert.deepEqual(read(counter), countText(source))
  t.diagnostic(JSON.stringify(receipts))
})

test('literal line boundaries preserve unicode edit context', () => {
  for (const source of [
    '中文\n\u0301👩🏽‍💻\n中文',
    '中文\r\n\u0301🇵🇭\r\n中文',
    '中文\r\u0301a\r中文',
    'a\r\n\n\r\r\nb',
    `${'中'.repeat(8191)}\r\n\u0301after\rnext\nlast`,
  ]) {
    const positions =
      source.length < 100
        ? [...Array(source.length + 1).keys()]
        : [8190, 8191, 8193, 8194]
    for (const from of positions)
      for (const insert of ['中', '\n', '\r', '\r\n', '\u0301', '👩🏽‍💻']) {
        const counter = new SourceCounter(
          new SourceStore(source, {
            tabId: 'source-line-context',
            revision: 0,
          }),
        )
        if (!counter.store.snapshot().isEditBoundary(from)) continue
        assert.deepEqual(read(counter), countText(source))
        edit(counter, [{ from, to: from, insert }])
        const after = source.slice(0, from) + insert + source.slice(from)
        assert.deepEqual(
          read(counter),
          countText(after),
          JSON.stringify({ source: source.slice(0, 40), from, insert }),
        )
        const changed = counter.store.snapshot()
        if (
          changed.isEditBoundary(from) &&
          changed.isEditBoundary(from + insert.length)
        ) {
          edit(counter, [{ from, to: from + insert.length, insert: '' }])
          assert.deepEqual(read(counter), countText(source))
        }
      }
  }
})
