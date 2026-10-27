import assert from 'node:assert/strict'
import test from 'node:test'
import { connectDocumentWorker } from '../src/renderer/src/document-worker-pool.ts'
import { DocumentSession } from '../src/shared/document-session.ts'
import { DocumentWorkerService } from '../src/shared/document-worker-service.ts'

class TestWorker {
  messages = []
  terminated = false
  onmessage = null
  onerror = null
  onmessageerror = null
  service = new DocumentWorkerService((reply) =>
    setImmediate(() => {
      if (!this.terminated) this.onmessage?.({ data: structuredClone(reply) })
    }),
  )
  postMessage(message) {
    this.messages.push(structuredClone(message))
    setImmediate(() => {
      if (!this.terminated) this.service.receive(message)
    })
  }
  terminate() {
    this.terminated = true
    this.service.dispose()
  }
}
function fixture(t, source) {
  const workers = []
  const session = new DocumentSession(
    source,
    { tabId: 'shared', revision: 0 },
    0,
    {
      enqueue: () => {},
    },
  )
  const connect = (extra = {}) => {
    const connection = connectDocumentWorker(session, {
      changed: () => {},
      pending: () => {},
      result: () => {},
      error: (message) => assert.fail(message),
      worker: () => {
        const worker = new TestWorker()
        workers.push(worker)
        return worker
      },
      ...extra,
    })
    t.after(() => connection.dispose())
    return connection
  }
  t.after(() => session.dispose())
  return { session, workers, connect }
}
const syntax = { gfm: false, alerts: false, textExtras: false }
const reference = (label) => [
  'commonmark',
  0,
  0,
  1,
  false,
  { ...syntax, label },
]
const config = {
  schema: 1,
  syntax: [],
  flavors: [],
  literal: [],
  opaque: [],
  prefix: 0,
  chunkSize: 4096,
  groupSize: 64,
  giantBlock: 65536,
}

test('panes serialize reference lookups without sharing callbacks or cancellation', async (t) => {
  const f = fixture(t, '[a]: /first\n[b]: /second\n\n[a] [b]')
  const a = Promise.withResolvers(),
    b = Promise.withResolvers()
  const formatted = f.connect({
    metadataResult: (_page, value) => a.resolve(value),
  })
  const source = f.connect({
    metadataResult: (_page, value) => b.resolve(value),
  })
  formatted.metadata(...reference('a'))
  source.metadata(...reference('b'))
  assert.equal((await a.promise).href, '/first')
  assert.equal((await b.promise).href, '/second')
  assert.equal(f.workers.length, 1)
  formatted.releaseMetadata()
  assert.equal(f.workers[0].terminated, false)
  formatted.dispose()
  const again = Promise.withResolvers()
  const third = f.connect({
    metadataResult: (_page, value) => again.resolve(value),
  })
  third.metadata(...reference('a'))
  assert.equal((await again.promise).href, '/first')
  assert.equal(f.workers.length, 1)
})

test('cancelling one pane keeps the other queued reference request', async (t) => {
  const f = fixture(t, '[a]: /first\n[b]: /second')
  const done = Promise.withResolvers()
  const formatted = f.connect({
    metadataResult: () => assert.fail('cancelled lookup'),
  })
  const source = f.connect({
    metadataResult: (_page, value) => done.resolve(value),
  })
  formatted.metadata(...reference('a'))
  source.metadata(...reference('b'))
  formatted.releaseMetadata()
  assert.equal((await done.promise).href, '/second')
  assert.equal(f.workers.length, 1)
})

test('panes serialize find results for each requesting pane', async (t) => {
  const f = fixture(t, 'alpha alpha beta')
  const first = []
  const done = Promise.withResolvers()
  const formatted = f.connect({
    result: (location) => first.push(location.total),
  })
  const source = f.connect({
    result: (location) => done.resolve(location.total),
  })
  formatted.find('alpha', 0, 0)
  source.find('beta', 0, 0)
  assert.equal(await done.promise, 1)
  assert.deepEqual(first, [2])
  assert.equal(f.workers.length, 1)
})

test('boundary pages keep their acknowledgement owner while panes queue and dispose', async (t) => {
  const f = fixture(t, '# first\n\nbody\n\n# last')
  const first = Promise.withResolvers(),
    second = Promise.withResolvers()
  const formatted = f.connect(),
    source = f.connect()
  let deliveries = 0
  formatted.boundaries(
    config,
    (page, acknowledge) => first.resolve({ page, acknowledge }),
    assert.fail,
  )
  source.boundaries(
    config,
    (page, acknowledge) => {
      deliveries++
      acknowledge()
      second.resolve(page)
    },
    assert.fail,
  )
  const held = await first.promise
  assert.equal(held.page.done, true)
  assert.equal(deliveries, 0)
  formatted.dispose()
  held.acknowledge()
  assert.equal((await second.promise).done, true)
  assert.equal(f.workers.length, 1)
})

test('late cancelled boundary pages cannot decline the next pane stream', async (t) => {
  const f = fixture(t, '# first\n\nbody')
  const held = Promise.withResolvers(),
    done = Promise.withResolvers()
  const formatted = f.connect(),
    source = f.connect()
  const declined = []
  formatted.boundaries(config, (page) => held.resolve(page), assert.fail)
  source.boundaries(
    config,
    (page, acknowledge) => {
      acknowledge()
      if (page.done) done.resolve()
    },
    (reason) => declined.push(reason),
  )
  const obsolete = await held.promise
  formatted.dispose()
  f.workers[0].onmessage({ data: obsolete })
  assert.deepEqual(declined, [])
  await done.promise
})

test('find cancellation and identical-query highlights stay pane-owned', async (t) => {
  const f = fixture(t, 'alpha alpha beta')
  const first = Promise.withResolvers(),
    second = Promise.withResolvers()
  const formatted = f.connect({
    result: (location, _action, starts) =>
      first.resolve({ total: location.total, starts }),
  })
  const source = f.connect({
    result: (location, _action, starts) =>
      second.resolve({ total: location.total, starts }),
  })
  formatted.find('alpha', 0, 0)
  source.find('beta', 0, 0)
  source.cancelFind()
  assert.deepEqual(await first.promise, { total: 2, starts: [0] })
  source.find('alpha', 0, 0)
  formatted.cancelFind()
  assert.deepEqual(await second.promise, { total: 2, starts: [0] })
  formatted.dispose()
  assert.equal(f.workers[0].terminated, false)
  source.dispose()
  assert.equal(f.workers[0].terminated, true)
})

test('reopening a completed pane search refreshes its highlight checkpoints', async (t) => {
  const f = fixture(t, 'alpha alpha')
  const reads = Array.from({ length: 3 }, () => Promise.withResolvers())
  let replies = 0
  const source = f.connect({
    result: (_location, _action, starts) => reads[replies++].resolve(starts),
  })
  source.find('alpha', 0, 0)
  assert.deepEqual(await reads[0].promise, [0])
  source.find('alpha', 1, 1)
  assert.equal(await reads[1].promise, undefined)
  source.cancelFind()
  source.find('alpha', 0, 0)
  assert.deepEqual(await reads[2].promise, [0])
})

test('two pane boundary streams retain paged acknowledgement and sequence ownership', async (t) => {
  const f = fixture(t, '# title\n\ntext\n\n'.repeat(20000))
  const paged = { ...config, chunkSize: 1024 }
  const first = Promise.withResolvers(),
    firstDone = Promise.withResolvers(),
    secondDone = Promise.withResolvers()
  const formatted = f.connect(),
    source = f.connect()
  const sequences = [[], []]
  formatted.boundaries(
    paged,
    (page, acknowledge) => {
      sequences[0].push(page.sequence)
      if (page.sequence === 0) first.resolve({ page, acknowledge })
      else acknowledge()
      if (page.done) firstDone.resolve()
    },
    assert.fail,
  )
  source.boundaries(
    paged,
    (page, acknowledge) => {
      sequences[1].push(page.sequence)
      acknowledge()
      if (page.done) secondDone.resolve()
    },
    assert.fail,
  )
  const held = await first.promise
  await new Promise(setImmediate)
  assert.equal(held.page.done, false)
  assert.deepEqual(sequences, [[0], []])
  held.acknowledge()
  held.acknowledge()
  await firstDone.promise
  await secondDone.promise
  for (const pages of sequences) {
    assert.ok(pages.length > 1)
    assert.deepEqual(
      pages,
      pages.map((_sequence, index) => index),
    )
  }
  assert.equal(f.workers.length, 1)
  assert.equal(
    f.workers[0].messages.filter(({ type }) => type === 'boundary-ack').length,
    sequences[0].length + sequences[1].length,
  )
})

test('two panes stream 50 mib once and a local edit sends one operation without rereading source', async (t) => {
  const sourceText = 'ordinary words. '.repeat((50 * 1024 * 1024) / 16)
  const f = fixture(t, sourceText)
  const first = Promise.withResolvers(),
    edited = Promise.withResolvers()
  let replies = 0
  const formatted = f.connect()
  const source = f.connect({
    result: () => (++replies === 1 ? first : edited).resolve(),
  })
  f.session.counters(true)
  formatted.find('', 0, 0)
  source.find('', 0, 0)
  await first.promise
  assert.equal(f.workers.length, 1)
  const worker = f.workers[0]
  const chunks = worker.messages.filter(
    (message) => message.type === 'load-chunk',
  )
  assert.equal(
    chunks.reduce(
      (sum, { chunk }) =>
        sum + chunk.chunks.reduce((units, text) => units + text.length, 0),
      0,
    ),
    sourceText.length,
  )
  assert.ok(
    chunks.every(
      ({ chunk }) =>
        chunk.chunks.reduce((sum, text) => sum + text.length, 0) <= 65536,
    ),
  )
  assert.equal(
    worker.messages.filter((message) => message.type === 'load-start').length,
    1,
  )
  assert.equal(f.session.counters().materializations, 0)
  f.session.counters(true)
  f.session.edit([{ from: 8, to: 8, insert: 'x' }], 'source', 'typing')
  source.find('', 0, 0)
  await edited.promise
  assert.equal(
    worker.messages.filter((message) => message.type === 'edit').length,
    1,
  )
  assert.equal(
    worker.messages.filter((message) => message.type === 'load-start').length,
    1,
  )
  const work = f.session.counters()
  assert.equal(work.materializations, 0)
  assert.ok(work.sourceUnitsRead < 4096, JSON.stringify(work))
  t.diagnostic(
    JSON.stringify({
      workers: f.workers.length,
      transferred: sourceText.length,
      work,
    }),
  )
})
