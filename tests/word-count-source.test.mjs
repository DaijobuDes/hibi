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
      const before = counter.store.snapshot().sliceRaw()
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
