import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(join(tmpdir(), 'hibi-index-tests-'))
const source = new URL('../src/addons/dictionary/', import.meta.url)
await build({
  entryPoints: [
    new URL('pack-index.ts', source).pathname,
    new URL('pack-runtime.ts', source).pathname,
  ],
  outdir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
})
await build({
  entryPoints: [new URL('pack-worker.ts', source).pathname],
  outfile: join(root, 'worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'tiny-converter',
      setup(b) {
        b.onResolve({ filter: /pack-converters$/ }, () => ({
          path: 'fixture',
          namespace: 'fixture',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      import { readFile } from 'node:fs/promises'
      import { openSync } from 'node:fs'
      export async function* convertEntries(id, paths) {
        if (paths[0] === 'hold-file') {
          openSync(paths[1], 'wx')
          for (let i = 0; i < 1000; i++) yield {
            word: 'held', keys: [], meanings: [], synonyms: [], antonyms: []
          }
          await new Promise(() => {})
        }
        if (paths[0] === 'wait') await new Promise(() => {})
        if (paths[0] === 'exit') process.exit(0)
        for (const entry of JSON.parse(await readFile(paths[0], 'utf8'))) yield entry
      }`,
          loader: 'js',
        }))
      },
    },
  ],
})
await writeFile(join(root, 'package.json'), '{"type":"module"}')
const { PackIndex, writePack, PACK_LIMITS } = await import(
  pathToFileURL(join(root, 'pack-index.js'))
)
const { PackWorker, completionPrefix } = await import(
  pathToFileURL(join(root, 'pack-runtime.js'))
)
const entry = (word, keys = [], definition = 'meaning') => ({
  word,
  keys,
  meanings: [
    { partOfSpeech: 'noun', definitions: [{ definition }], synonyms: [] },
  ],
  synonyms: [],
  antonyms: [],
})
async function* entries(values) {
  yield* values
}
let sequence = 0
async function directory(t) {
  const path = join(root, String(++sequence))
  await mkdir(path)
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
test.after(() => rm(root, { recursive: true, force: true }))

test('warm lookup latency on 10000 entries', async (t) => {
  const dir = await directory(t)
  await writePack(
    'en',
    entries(Array.from({ length: 10000 }, (_, i) => entry(`word${i}`))),
    dir,
  )
  const worker = new PackWorker(pathToFileURL(join(root, 'worker.mjs')))
  t.after(() => worker.close())
  await worker.lookup('en', dir, 'word9999')
  const times = []
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    assert.equal(
      (await worker.lookup('en', dir, `word${i * 97}`))[0].word,
      `word${i * 97}`,
    )
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  t.diagnostic(
    `warm worker lookup p95: ${times[94].toFixed(2)}ms; max: ${times[99].toFixed(2)}ms`,
  )
})
test('worker rejects thread startup failure and bounds queued tasks; close settles every pending job', async (t) => {
  const bad = new PackWorker(pathToFileURL(join(root, 'absent.mjs')))
  t.after(() => bad.close())
  await assert.rejects(bad.unload(), /Cannot find module/)
  const worker = new PackWorker(pathToFileURL(join(root, 'worker.mjs')))
  t.after(() => worker.close())
  const waiting = worker.convert(
    'en',
    ['wait'],
    await directory(t),
    new AbortController().signal,
    () => {},
  )
  const outcome = waiting.catch((error) => error.message)
  await new Promise(setImmediate)
  const queued = Array.from({ length: 64 }, () =>
    worker.unload().then(
      () => 'resolved',
      (error) => error.message,
    ),
  )
  await new Promise(setImmediate)
  await worker.close()
  const results = await Promise.all(queued)
  assert.equal(await outcome, 'Dictionary worker closed')
  assert.equal(
    results.filter((error) => error === 'Dictionary worker queue full').length,
    1,
  )
  assert.equal(
    results.filter((error) => error === 'Dictionary worker closed').length,
    63,
  )
})

test('streamed utf8 offsets, hashes, aliases, duplicates, suffixes and exact priority', async (t) => {
  const dir = await directory(t)
  const values = [
    entry('cat', ['cat']),
    entry('cat', [], 'second'),
    entry('cats'),
    entry('Cat'),
    entry("don't"),
    entry('mouse', ['mice']),
    entry('run'),
    entry('make'),
    entry('city'),
    entry('猫', ['ねこ']),
  ]
  const stats = await writePack('en', entries(values), dir)
  assert.equal(stats.entries, values.length)
  for (const name of ['data', 'index']) {
    const buffer = await readFile(
      join(dir, name === 'data' ? 'data.jsonl' : 'index.json'),
    )
    assert.equal(stats[name].bytes, buffer.length)
    assert.equal(
      stats[name].sha256,
      createHash('sha256').update(buffer).digest('hex'),
    )
  }
  const index = new PackIndex()
  t.after(() => index.unload())
  assert.equal((await index.lookup('en', dir, 'cat')).length, 2)
  assert.equal((await index.lookup('en', dir, 'cats'))[0].word, 'cats')
  assert.equal((await index.lookup('en', dir, 'Cat')).length, 1)
  for (const [query, word] of [
    ['CAT', 'cat'],
    ['DON’T', "don't"],
    ['mice', 'mouse'],
    ['running', 'run'],
    ['making', 'make'],
    ['cities', 'city'],
    ['ねこ', '猫'],
  ])
    assert.equal((await index.lookup('en', dir, query))[0].word, word)
  assert.deepEqual(await index.lookup('en', dir, 'missing'), [])
  await assert.rejects(index.lookup('en', dir, 'x'.repeat(257)))
})
test('bounds records and lookup result count; failed loads leave other packs usable', async (t) => {
  const dir = await directory(t)
  await writePack(
    'tl',
    entries(Array.from({ length: 40 }, () => entry('Salita'))),
    dir,
  )
  const index = new PackIndex()
  t.after(() => index.unload())
  assert.equal(
    (await index.lookup('tl', dir, 'SALITA')).length,
    PACK_LIMITS.results,
  )
  await index.unload()
  const bad = await directory(t)
  await assert.rejects(
    writePack(
      'en',
      entries([entry('huge', [], 'x'.repeat(PACK_LIMITS.record))]),
      bad,
    ),
  )
  await assert.rejects(index.lookup('en', bad, 'huge'))
  assert.equal(
    (await index.lookup('tl', dir, 'Salita')).length,
    PACK_LIMITS.results,
  )
})
test('resident indexes survive language switches and selective unload; byte cap evicts least recently used', async (t) => {
  const dirs = {}
  for (const id of ['en', 'tl', 'fr']) {
    dirs[id] = await directory(t)
    await writePack(id, entries([entry('word')]), dirs[id])
  }
  const probe = new PackIndex()
  await probe.lookup('en', dirs.en, 'word')
  const bytes = probe.residentBytes
  await probe.unload()
  assert.equal(probe.residentBytes, 0)
  const index = new PackIndex(bytes * 2)
  t.after(() => index.unload())
  for (const id of ['en', 'tl', 'en', 'fr'])
    assert.equal((await index.lookup(id, dirs[id], 'word'))[0].word, 'word')
  assert.equal(index.residentBytes, bytes * 2)
  for (const dir of Object.values(dirs))
    await writeFile(join(dir, 'index.json'), '{')
  for (const id of ['en', 'fr'])
    assert.equal((await index.lookup(id, dirs[id], 'word'))[0].word, 'word')
  await assert.rejects(index.lookup('tl', dirs.tl, 'word'))
  await index.unload('en')
  assert.equal(index.residentBytes, bytes)
  await assert.rejects(index.lookup('en', dirs.en, 'word'))
  assert.equal((await index.lookup('fr', dirs.fr, 'word'))[0].word, 'word')
})

test('oversized resident index answers once without retaining its handle or exceeding the cache cap', async (t) => {
  const dir = await directory(t)
  await writePack('en', entries([entry('cat')]), dir)
  const index = new PackIndex(1)
  t.after(() => index.unload())
  assert.equal((await index.lookup('en', dir, 'cat'))[0].word, 'cat')
  assert.equal(index.residentBytes, 0)
  await writeFile(join(dir, 'index.json'), '{')
  await assert.rejects(index.lookup('en', dir, 'cat'))
})

test('reject corrupt index, traversal offsets, duplicate rows, record boundaries and sparse oversized files', async (t) => {
  const dir = await directory(t)
  await writePack('en', entries([entry('cat')]), dir)
  const original = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
  const index = new PackIndex()
  t.after(() => index.unload())
  for (const mutate of [
    (p) => {
      p.rows[0][1][0][0] = '../secret'
    },
    (p) => {
      p.rows[0][1][0][0] = -1
    },
    (p) => {
      p.rows[0][1][0][1] = PACK_LIMITS.record + 1
    },
    (p) => {
      p.rows.push(p.rows[0])
    },
    (p) => {
      p.rows[0][1].push(p.rows[0][1][0])
    },
    (p) => {
      p.id = 'ja'
    },
    (p) => {
      p.rows[0][1][0][0] = 1
      p.rows[0][1][0][1]--
    },
    (p) => {
      p.rows[0][1][0][1]--
    },
  ]) {
    const p = structuredClone(original)
    mutate(p)
    await writeFile(join(dir, 'index.json'), JSON.stringify(p))
    await assert.rejects(index.lookup('en', dir, 'cat'))
    await index.unload()
  }
  await writeFile(join(dir, 'index.json'), '{')
  await assert.rejects(index.lookup('en', dir, 'cat'))
  await truncate(join(dir, 'index.json'), PACK_LIMITS.index + 1)
  await assert.rejects(index.lookup('en', dir, 'cat'))
  await writeFile(join(dir, 'index.json'), JSON.stringify(original))
  await writeFile(join(dir, 'data.jsonl'), 'invalid\n')
  await assert.rejects(index.lookup('en', dir, 'cat'))
})
test('reject valid-json invalid entries and cross-key offsets; bound data size and output bytes', async (t) => {
  const dir = await directory(t)
  await writePack('en', entries([entry('cat'), entry('dog')]), dir)
  const original = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
  const index = new PackIndex()
  t.after(() => index.unload())
  const swapped = structuredClone(original)
  swapped.rows[0][1] = swapped.rows[1][1]
  await writeFile(join(dir, 'index.json'), JSON.stringify(swapped))
  await assert.rejects(index.lookup('en', dir, 'cat'))
  await index.unload()
  await writeFile(join(dir, 'index.json'), JSON.stringify(original))
  await truncate(join(dir, 'data.jsonl'), PACK_LIMITS.data + 1)
  await assert.rejects(index.lookup('en', dir, 'cat'))
  const bad = await directory(t)
  const buffer = Buffer.from(
    `${JSON.stringify({ word: 'cat', keys: [], meanings: 'invalid', synonyms: [], antonyms: [] })}\n`,
  )
  await writeFile(join(bad, 'data.jsonl'), buffer)
  await writeFile(
    join(bad, 'index.json'),
    JSON.stringify({
      version: 1,
      id: 'en',
      rows: [['cat', [[0, buffer.length]]]],
    }),
  )
  await assert.rejects(index.lookup('en', bad, 'cat'))
  await index.unload()
  const large = await directory(t)
  await writePack(
    'en',
    entries(
      Array.from({ length: 20 }, () => entry('big', [], 'x'.repeat(60000))),
    ),
    large,
  )
  const results = await index.lookup('en', large, 'big')
  assert.ok(results.length > 0 && results.length < PACK_LIMITS.results)
  assert.ok(Buffer.byteLength(JSON.stringify(results)) <= PACK_LIMITS.output)
})
test('french lowercase aliases preserve exact accents', async (t) => {
  const dir = await directory(t)
  await writePack('fr', entries([entry('école')]), dir)
  const index = new PackIndex()
  t.after(() => index.unload())
  assert.equal((await index.lookup('fr', dir, 'ÉCOLE'))[0].word, 'école')
  assert.deepEqual(await index.lookup('fr', dir, 'ecole'), [])
})
test('lookup and completion accept nfd french and voiced kana', async (t) => {
  const index = new PackIndex()
  t.after(() => index.unload())
  const worker = new PackWorker(pathToFileURL(join(root, 'worker.mjs')))
  t.after(() => worker.close())
  for (const [id, word, prefix] of [
    ['fr', 'école', 'é'],
    ['ja', 'がくせい', 'が'],
  ]) {
    const dir = await directory(t)
    await writePack(id, entries([entry(word)]), dir)
    const nfdWord = word.normalize('NFD')
    const nfdPrefix = prefix.normalize('NFD')
    assert.equal(completionPrefix(` ${nfdPrefix} `), prefix)
    assert.equal((await index.lookup(id, dir, nfdWord))[0].word, word)
    assert.deepEqual(await index.complete(id, dir, nfdPrefix), [word])
    assert.equal((await worker.lookup(id, dir, nfdWord))[0].word, word)
    assert.deepEqual(await worker.complete(id, dir, nfdPrefix), [word])
  }
})

test('completion skips case aliases without consuming limit slots', async (t) => {
  const dir = await directory(t)
  await writePack(
    'fr',
    entries([
      entry('Paris', ['paris']),
      entry('paris', [], 'another sense'),
      entry('partir'),
    ]),
    dir,
  )
  const index = new PackIndex()
  t.after(() => index.unload())
  assert.deepEqual(await index.complete('fr', dir, 'pa', 2), [
    'Paris',
    'partir',
  ])
  assert.deepEqual(await index.complete('fr', dir, 'PA', 1), ['Paris'])
})

test('preloaded prefix search bounds results and normalizes source spelling and reading keys', async (t) => {
  const index = new PackIndex()
  t.after(() => index.unload())
  const en = await directory(t)
  await writePack(
    'en',
    entries([
      entry("don't"),
      ...Array.from({ length: 20 }, (_, i) =>
        entry(`cat${String(i).padStart(2, '0')}`),
      ),
    ]),
    en,
  )
  await index.preload('en', en)
  const resident = index.residentBytes
  await writeFile(join(en, 'index.json'), '{')
  assert.equal((await index.complete('en', en, 'CAT')).length, 8)
  assert.deepEqual(await index.complete('en', en, 'DON’'), ["don't"])
  assert.deepEqual(await index.complete('en', en, 'cat', 2), ['cat00', 'cat01'])
  assert.deepEqual(await index.complete('en', en, 'missing'), [])
  assert.deepEqual(await index.complete('en', en, ''), [])
  assert.equal(index.residentBytes, resident)
  for (const limit of [0, -1, 33, 1.5, '8', NaN])
    await assert.rejects(index.complete('en', en, 'cat', limit))
  await assert.rejects(index.complete('en', en, 'x'.repeat(257)))
  await assert.rejects(index.complete('en', en, '\0'))
  for (const [id, word, aliases, prefix, expected] of [
    ['fr', 'école', ['écolier'], 'ÉC', ['école', 'écolier']],
    ['tl', 'bahay', [], 'BA', ['bahay']],
    ['ja', '猫', ['ねこ'], 'ね', ['ねこ']],
    ['zh', '猫', ['貓'], '貓', ['貓']],
    ['yue', '凄切', ['淒切'], '淒', ['淒切']],
  ]) {
    const dir = await directory(t)
    await writePack(id, entries([entry(word, aliases)]), dir)
    assert.deepEqual(await index.complete(id, dir, prefix), expected)
  }
})

test('reject symlink files and symlink directory', async (t) => {
  const dir = await directory(t)
  await writePack('en', entries([entry('cat')]), dir)
  const linked = await directory(t)
  await symlink(join(dir, 'data.jsonl'), join(linked, 'data.jsonl'))
  await symlink(join(dir, 'index.json'), join(linked, 'index.json'))
  const index = new PackIndex()
  t.after(() => index.unload())
  await assert.rejects(index.lookup('en', linked, 'cat'))
  const link = join(linked, 'directory')
  await symlink(dir, link)
  await assert.rejects(index.lookup('en', link, 'cat'))
  await assert.rejects(index.lookup('en', `${link}/`, 'cat'))
})
test('conversion cancellation rejects after worker exit and scratch handle release', async (t) => {
  const worker = new PackWorker(pathToFileURL(join(root, 'worker.mjs')))
  t.after(() => worker.close())
  const dir = await directory(t)
  const controller = new AbortController()
  let ready
  const opened = new Promise((resolve) => {
    ready = resolve
  })
  const conversion = worker.convert(
    'en',
    ['hold-file', join(dir, 'held-open')],
    dir,
    controller.signal,
    () => ready(),
  )
  await opened
  assert.ok((await readFile(join(dir, 'data.jsonl'))).length > 0)
  let exited = false
  worker.worker.once('exit', () => {
    exited = true
  })
  controller.abort()
  await assert.rejects(conversion, { name: 'AbortError' })
  assert.equal(exited, true)
  await rm(dir, { recursive: true })
  await assert.rejects(readFile(join(dir, 'held-open')), { code: 'ENOENT' })
})
test('worker queues conversion/lookup, progress, cancellation/restart, exit and close', async (t) => {
  const worker = new PackWorker(pathToFileURL(join(root, 'worker.mjs')))
  t.after(() => worker.close())
  const dir = await directory(t)
  const input = join(dir, 'input.json')
  await writeFile(input, JSON.stringify([entry('cat')]))
  const progress = []
  const converting = worker.convert(
    'en',
    [input],
    dir,
    new AbortController().signal,
    (n) => progress.push(n),
  )
  const lookup = worker.lookup('en', dir, 'cat')
  assert.equal((await converting).entries, 1)
  assert.equal((await lookup)[0].word, 'cat')
  assert.deepEqual(progress, [1])
  await worker.unload()
  const abort = new AbortController()
  const cancelled = worker.convert(
    'en',
    ['wait'],
    await directory(t),
    abort.signal,
    () => {},
  )
  await new Promise(setImmediate)
  const queued = worker.lookup('en', dir, 'cat')
  const assertions = [
    assert.rejects(cancelled, { name: 'AbortError' }),
    assert.rejects(queued, { name: 'AbortError' }),
  ]
  await new Promise(setImmediate)
  abort.abort()
  await Promise.all(assertions)
  assert.equal((await worker.lookup('en', dir, 'cat'))[0].word, 'cat')
  await assert.rejects(
    worker.convert(
      'en',
      ['exit'],
      await directory(t),
      new AbortController().signal,
      () => {},
    ),
    /exited/,
  )
  assert.equal((await worker.lookup('en', dir, 'cat'))[0].word, 'cat')
  await assert.rejects(
    worker.convert(
      'en',
      ['missing'],
      await directory(t),
      new AbortController().signal,
      () => {},
    ),
  )
  const stopped = new AbortController()
  stopped.abort()
  await assert.rejects(
    worker.convert('en', [input], dir, stopped.signal, () => {}),
    { name: 'AbortError' },
  )
  await worker.close()
  await assert.rejects(worker.lookup('en', dir, 'cat'), /closed/)
})
