import assert from 'node:assert/strict'
import test from 'node:test'
import { countText } from '../src/addons/word-count/count.ts'
import { richText } from '../src/addons/word-count/formatted-text.ts'
import { defaultNoteSyntax } from '../src/shared/note-syntax.ts'
import { SourceStore } from '../src/shared/source-buffer.ts'
import { SourceTransferSender } from '../src/shared/source-transfer.ts'

for (const mode of ['source', 'formatted'])
  test(`worker keeps cjk source-count edit bursts local after switching to ${mode}`, async (t) => {
    const id = `cjk-${mode}`
    const messages = []
    let notify = () => {}
    const worker = {
      postMessage: (message) => {
        messages.push(message)
        notify()
      },
    }
    globalThis.self = worker
    const send = (data) => worker.onmessage({ data })
    t.after(() => {
      if (worker.onmessage) send({ kind: 'close', streamId: id })
      delete globalThis.self
    })
    await import(`../src/addons/word-count/counter.worker.ts?edit-cost-${mode}`)
    async function next() {
      while (!messages.length)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('worker reply timeout')),
            5000,
          )
          notify = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      return messages.shift()
    }
    let source = `${'中文'.repeat(100)}\n\n`.repeat(1300)
    const sender = new SourceTransferSender(
      {
        tabId: id,
        revision: 0,
        contentVersion: 0,
        streamId: id,
        length: source.length,
      },
      [source],
    )
    send({ kind: 'open', head: sender.head })
    for (;;) {
      const message = await next()
      if (message.kind === 'ready') {
        sender.finish(message.request)
        break
      }
      assert.equal(message.kind, 'chunk')
      send({ kind: 'chunk', chunk: sender.read(message.request) })
    }
    const count = (mode, version) =>
      send({
        kind: 'count',
        streamId: id,
        version,
        syntax: defaultNoteSyntax,
        mode: mode === 'source' ? 'source' : undefined,
      })
    count('source', 0)
    assert.deepEqual((await next()).result, countText(source))
    if (mode === 'formatted') {
      count(mode, 0)
      assert.deepEqual(
        (await next()).result,
        countText(richText(source, defaultNoteSyntax).slice(1)),
      )
    }
    let store
    const prepare = SourceStore.prototype.prepare
    t.mock.method(SourceStore.prototype, 'prepare', function (operation) {
      store = this
      this.counters(true)
      return prepare.call(this, operation)
    })
    const segment = Intl.Segmenter.prototype.segment
    const lengths = []
    t.mock.method(Intl.Segmenter.prototype, 'segment', function (input) {
      lengths.push(input.length)
      return segment.call(this, input)
    })
    const receipts = []
    for (let version = 1; version <= 5; version++) {
      lengths.length = 0
      send({
        kind: 'edit',
        streamId: id,
        operation: {
          document: { tabId: id, revision: 0 },
          operationId: `cjk-${version}`,
          baseVersion: version - 1,
          contentVersion: version,
          origin: 'source',
          historyGroup: 'cjk-burst',
          changes: [{ from: 101, to: 101, insert: '中' }],
        },
      })
      source = `${source.slice(0, 101)}中${source.slice(101)}`
      const work = {
        version,
        maximumInput: Math.max(0, ...lengths),
        segmentationUnits: lengths.reduce((sum, length) => sum + length, 0),
        ...store.counters(),
      }
      receipts.push(work)
      assert.ok(work.maximumInput < 1024, JSON.stringify(work))
      assert.ok(work.segmentationUnits < 4096, JSON.stringify(work))
      assert.ok(work.sourceUnitsRead < 4096, JSON.stringify(work))
      assert.equal(work.materializations, 0)
      assert.equal(work.materializedUnits, 0)
      assert.equal(messages.length, 0, 'edits do not request another count')
    }
    count('source', 5)
    assert.deepEqual((await next()).result, countText(source))
    if (mode === 'formatted') {
      count(mode, 5)
      assert.deepEqual(
        (await next()).result,
        countText(richText(source, defaultNoteSyntax).slice(1)),
      )
    }
    t.diagnostic(JSON.stringify({ mode, receipts }))
  })
