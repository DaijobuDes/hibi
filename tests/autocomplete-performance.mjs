import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createLearning } from '../src/addons/autocomplete/learning.ts'
import { createPersonalModel } from '../src/addons/autocomplete/model.ts'

// Run with node tests/autocomplete-performance.mjs; load time is excluded.
// Before: undo 236.092, trim 181.790, save 237.927, idle 44.075 ms (6 samples).
const languages = ['en', 'tl', 'fr', 'ja', 'zh', 'yue']
const session = { scope: 'notes', languages, context: ['that', 'was'] }
const word = (i) =>
  'prefix' +
  String.fromCharCode(97 + (i % 26)) +
  String.fromCharCode(97 + (Math.floor(i / 26) % 26)) +
  String.fromCharCode(97 + Math.floor(i / 676))
const time = Date.now()
const snapshot = {
  version: 1,
  entries: Array.from({ length: 3700 }, (_, i) => ({
    ...session,
    context: [[], ['was'], ['that', 'was']][i % 3],
    word: word(i),
    count: 2,
    corrections: 0,
    updatedAt: time,
    lastUsed: time,
  })),
}
const samples = { undo: [], trim: [], save: [], idle: [] }
for (let run = 0; run < 7; run++) {
  let now = time
  const undo = createPersonalModel({ snapshot, now: () => now })
  const accepted = { ...session, word: 'newword', kind: 'accepted' }
  undo.observe(accepted)
  now += 1000
  let start = performance.now()
  undo.observe({ ...accepted, kind: 'undo' })
  if (run) samples.undo.push(performance.now() - start)
  assert.equal(undo.snapshot().entries.length, 3701)

  const trim = createPersonalModel({
    snapshot,
    maxEntries: 3700,
    now: () => time,
  })
  start = performance.now()
  trim.observe({ ...session, word: 'newword', kind: 'typed' })
  if (run) samples.trim.push(performance.now() - start)
  assert.equal(trim.snapshot().entries.length, 3330)

  // A weak row expires between load and save; others remain active.
  const realNow = Date.now
  let saveTime = time
  Date.now = () => saveTime
  let value = {
    version: 1,
    entries: snapshot.entries.map((row, i) => ({
      ...row,
      count: i ? 2 : 0.02,
      updatedAt: time,
      lastUsed: time,
    })),
  }
  const callbacks = new Set()
  const storage = {
    snapshot: () => ({ status: 'ready', revision: 0, value }),
    subscribe: () => () => {},
    async set(saved) {
      value = JSON.parse(JSON.stringify(saved))
      return { status: 'saved' }
    },
  }
  const learning = createLearning(storage, (run) => {
    callbacks.add(run)
    return () => callbacks.delete(run)
  })
  learning.suggest({ ...session, prefix: 'prefix' })
  saveTime += 1000
  start = performance.now()
  await learning.persist()
  if (run) samples.save.push(performance.now() - start)
  assert.equal(value.entries.length, 3699)
  for (let i = 0; i < 128; i++)
    learning.observe({ ...session, word: word(i), kind: 'typed' })
  start = performance.now()
  for (const callback of [...callbacks])
    callback({ didTimeout: false, timeRemaining: () => 50 })
  if (run) samples.idle.push(performance.now() - start)
  learning.dispose()
  Date.now = realNow
}
for (const [operation, timings] of Object.entries(samples)) {
  timings.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      operation,
      rows: 3700,
      samples: timings.length,
      medianMs: timings[Math.floor(timings.length / 2)],
      maxMs: timings.at(-1),
    }),
  )
}
