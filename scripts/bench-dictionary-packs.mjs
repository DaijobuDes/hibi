import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const sourceDirectory = process.argv[2]
if (!sourceDirectory)
  throw new Error(
    'usage: node scripts/bench-dictionary-packs.mjs <local-source-directory> [output-directory] [language-ids] [--all-six]',
  )
const sources = resolve(sourceDirectory)
const output = resolve(process.argv[3] ?? join(sources, 'bench'))
const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const metadata = await readFile(join(sources, 'metadata.json'), 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
const require = createRequire(import.meta.url)
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(join(output, '.probe-'))
let worker
const results = []
const converted = []
const mixed = []
const directories = []
const run = promisify(execFile)
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  }
}
try {
  await build({
    absWorkingDir: repo,
    entryPoints: [
      'src/addons/dictionary/pack-worker.ts',
      'src/addons/dictionary/pack-runtime.ts',
    ],
    outdir: scratch,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    plugins: [
      {
        name: 'external-unzipper',
        setup(b) {
          b.onResolve({ filter: /^unzipper$/ }, () => ({
            path: require.resolve('unzipper'),
            external: true,
          }))
        },
      },
    ],
  })
  await build({
    absWorkingDir: repo,
    stdin: {
      resolveDir: repo,
      contents: `
        import { PackIndex, PACK_LIMITS } from './src/addons/dictionary/pack-index'
        ;(async () => {
        const input = JSON.parse(process.argv[2])
        const packs = Array.isArray(input) ? input : [input]
        const index = new PackIndex()
        if (typeof index.residentBytes !== 'number')
          throw new Error('PackIndex.residentBytes required')
        const collect = () => { for (let i = 0; i < 3; i++) global.gc() }
        collect()
        const baseline = process.memoryUsage()
        let sampledHeap = baseline.heapUsed, sampledRss = baseline.rss
        const sample = () => {
          const memory = process.memoryUsage()
          sampledHeap = Math.max(sampledHeap, memory.heapUsed)
          sampledRss = Math.max(sampledRss, memory.rss)
        }
        const timer = setInterval(sample, 5)
        const start = performance.now()
        for (const pack of packs) {
          if (!(await index.lookup(pack.id, pack.directory, pack.words[0])).length)
            throw new Error('Probe word absent')
        }
        const directColdLoadMs = performance.now() - start
        sample()
        clearInterval(timer)
        collect()
        const retained = process.memoryUsage()
        console.log(JSON.stringify({
          directColdLoadMs, memoryBudgetBytes: PACK_LIMITS.resident,
          lruAccountedBytes: index.residentBytes,
          baseline, retained,
          retainedHeapDeltaBytes: retained.heapUsed - baseline.heapUsed,
          retainedArrayBuffersDeltaBytes: retained.arrayBuffers - baseline.arrayBuffers,
          retainedHeapAndArrayBuffersDeltaBytes: retained.heapUsed + retained.arrayBuffers - baseline.heapUsed - baseline.arrayBuffers,
          processRssDeltaBytes: retained.rss - baseline.rss,
          sampledAllocatedHeapHighWaterDeltaBytes: sampledHeap - baseline.heapUsed,
          sampledProcessRssHighWaterDeltaBytes: sampledRss - baseline.rss,
        }))
        await index.unload()
        })().catch((error) => { console.error(error); process.exitCode = 1 })
      `,
    },
    outfile: join(scratch, 'memory.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
  const { PackWorker } = await import(
    pathToFileURL(join(scratch, 'pack-runtime.cjs'))
  )
  worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
  async function jsonl(id) {
    for (const name of [`${id}.jsonl.gz`, `${id}.jsonl`]) {
      try {
        await stat(join(sources, name))
        return name
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    throw new Error(`missing source: ${id}`)
  }
  const packs = [
    {
      id: 'en',
      files: ['en.xml.gz'],
      words: ['dog', 'cat', 'dogs', 'run', 'house'],
    },
    {
      id: 'zh',
      files: ['zh.txt.gz'],
      words: ['中國', '人', '中国', '水', '好'],
    },
    {
      id: 'yue',
      files: ['yue.zip', 'yue-readings.zip', 'zh.txt.gz'],
      words: ['香港', '人', '一世人', '凄切'],
    },
    { id: 'ja', files: ['ja.gz'], words: ['猫', '犬', 'ねこ', '水', '学校'] },
  ]
  for (const [id, words] of [
    ['tl', ['bahay', 'tao', 'BAHAY', 'tubig', 'maganda']],
    ['fr', ['maison', 'chat', 'MAISON', 'chien', 'eau']],
    ['de', ['Haus', 'haus', 'schön', 'Straße', 'gehen']],
  ]) {
    const file = await jsonl(id).catch(() => undefined)
    if (file) packs.push({ id, files: [file], words })
  }
  const requested = process.argv[4]?.startsWith('--')
    ? undefined
    : process.argv[4]?.split(',')
  if (requested?.some((id) => !packs.some((pack) => pack.id === id)))
    throw new Error('unknown or unavailable benchmark language')
  for (const pack of packs.filter(
    (pack) => !requested || requested.includes(pack.id),
  )) {
    const directory = await mkdtemp(join(output, `${pack.id}-`))
    directories.push(directory)
    const paths = pack.files.map((name) => join(sources, name))
    const downloadBytes = (
      await Promise.all(
        paths.map(async (path, i) => {
          const bytes = (await stat(path)).size
          if (
            metadata?.[pack.files[i]] &&
            metadata[pack.files[i]].bytes !== bytes
          )
            throw new Error(`source size differs from metadata: ${path}`)
          return bytes
        }),
      )
    ).reduce((sum, bytes) => sum + bytes, 0)
    try {
      await worker.close()
      worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
      const stats = await worker.convert(
        pack.id,
        paths,
        directory,
        new AbortController().signal,
        () => {},
      )
      await worker.close()
      const { stdout } = await run(process.execPath, [
        '--expose-gc',
        join(scratch, 'memory.cjs'),
        JSON.stringify({ ...pack, directory }),
      ])
      const memory = JSON.parse(stdout)
      worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
      const start = performance.now()
      const first = await worker.lookup(pack.id, directory, pack.words[0])
      const firstLoadMs = performance.now() - start
      const cold = performance.now()
      const second = await worker.lookup(pack.id, directory, pack.words[1])
      const coldFirstWordAfterLoadMs = performance.now() - cold
      if (!first.length || !second.length)
        throw new Error(`benchmark probe word absent: ${pack.id}`)
      const times = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        const result = await worker.lookup(
          pack.id,
          directory,
          pack.words[i % pack.words.length],
        )
        if (!result.length)
          throw new Error(
            `benchmark probe word absent: ${pack.words[i % pack.words.length]}`,
          )
        times.push(performance.now() - start)
      }
      times.sort((a, b) => a - b)
      await worker.close()
      worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
      const preloadStart = performance.now()
      await worker.preload(pack.id, directory)
      const preloadMs = performance.now() - preloadStart
      const afterPreloadStart = performance.now()
      const afterPreload = await worker.lookup(
        pack.id,
        directory,
        pack.words[0],
      )
      const firstAfterPreloadMs = performance.now() - afterPreloadStart
      if (!afterPreload.length)
        throw new Error(`after-preload probe word absent: ${pack.id}`)
      const prefixes = pack.words.map((word) => [...word].slice(0, 2).join(''))
      const completionTimes = []
      for (let i = 0; i < 100; i++) {
        const prefix = prefixes[i % prefixes.length]
        const start = performance.now()
        const entries = await worker.complete(pack.id, directory, prefix, 8)
        completionTimes.push(performance.now() - start)
        if (!entries.length || entries.length > 8)
          throw new Error(`completion probe failed: ${pack.id}/${prefix}`)
      }
      const result = {
        id: pack.id,
        sourceFiles: pack.files,
        downloadBytes,
        ...stats,
        ...memory,
        convertedBytes: stats.data.bytes + stats.index.bytes,
        firstLoadMs,
        preloadMs,
        firstAfterPreloadMs,
        completionPrefixes: prefixes,
        completionWarm: summary(completionTimes),
        coldFirstWordAfterLoadMs,
        warmP50Ms: times[49],
        warmP95Ms: times[94],
        warmMaxMs: times[99],
        firstWord: pack.words[0],
        firstWordResults: first.length,
      }
      results.push(result)
      converted.push({ ...pack, directory })
      console.log(JSON.stringify(result))
    } catch (error) {
      const result = { id: pack.id, downloadBytes, error: error.message }
      results.push(result)
      console.log(JSON.stringify(result))
      process.exitCode = 1
    } finally {
      await worker.close()
    }
  }
  for (const ids of [
    ['en', 'tl', 'fr'],
    ['zh', 'yue', 'ja'],
    ...(process.argv.includes('--all-six')
      ? [['en', 'tl', 'fr', 'zh', 'yue', 'ja']]
      : []),
  ]) {
    const candidates = ids.map((id) => converted.find((pack) => pack.id === id))
    if (candidates.some((pack) => !pack)) continue
    await worker.close()
    worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
    const { stdout } = await run(process.execPath, [
      '--expose-gc',
      join(scratch, 'memory.cjs'),
      JSON.stringify(candidates),
    ])
    const memory = JSON.parse(stdout)
    const queries = candidates.flatMap((pack) =>
      pack.words.map((word) => ({ owner: pack.id, word })),
    )
    const lookup = async ({ owner, word }) => {
      let ownerFound = false
      const start = performance.now()
      for (const pack of candidates) {
        const entries = await worker.lookup(pack.id, pack.directory, word)
        if (pack.id === owner && entries.length) ownerFound = true
      }
      if (!ownerFound)
        throw new Error(`mixed probe word absent: ${owner}/${word}`)
      return performance.now() - start
    }
    const coldStart = performance.now()
    for (const query of queries) await lookup(query)
    const coldPassMs = performance.now() - coldStart
    await worker.close()
    worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
    const preloadStart = performance.now()
    for (const pack of candidates) await worker.preload(pack.id, pack.directory)
    const preloadMs = performance.now() - preloadStart
    const firstAfterPreloadMs = await lookup(queries[0])
    const times = [],
      passes = []
    for (let pass = 0; pass < 100; pass++) {
      const start = performance.now()
      for (const query of queries) times.push(await lookup(query))
      passes.push(performance.now() - start)
    }
    const result = {
      ids,
      queries,
      passes: 100,
      candidateRequestsPerLookup: ids.length,
      memory,
      coldPassMs,
      preloadMs,
      firstAfterPreloadMs,
      lookup: summary(times),
      pass: summary(passes),
    }
    mixed.push(result)
    console.log(JSON.stringify({ mixed: result }))
  }
  if (process.env.PACK_STORE_PROBE) {
    const { stdout } = await run(process.execPath, [
      resolve(process.env.PACK_STORE_PROBE),
      JSON.stringify({ scratch, converted, results, sources, output }),
    ])
    console.log(stdout.trim())
  }
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        samples: 100,
        note: 'cold load includes index parsing and worker startup where applicable; OS cache is not cleared. memory is a fresh child running PackIndex directly, not worker heap. retained heap follows three explicit GCs; RSS is whole-process and includes allocator retention, code and buffers. sampled allocation high-water uses 5ms timer plus lookup-end sample: lower bound, synchronous parsing peaks may be missed. LRU-accounted bytes are policy estimates, not measured heap. mixed passes query all candidate packs for each term; no unload between passes.',
        mixed,
        results,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await worker?.close()
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true })
  await rm(scratch, { recursive: true, force: true })
}
