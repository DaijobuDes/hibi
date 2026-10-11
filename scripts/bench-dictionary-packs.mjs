import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const sourceDirectory = process.argv[2]
if (!sourceDirectory)
  throw new Error(
    'usage: node scripts/bench-dictionary-packs.mjs <local-source-directory> [output-directory] [language-ids]',
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
const scratch = await mkdtemp(join(tmpdir(), 'hibi-pack-bench-'))
await mkdir(output, { recursive: true })
let worker
const results = []
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
  const { PackWorker } = await import(
    pathToFileURL(join(scratch, 'pack-runtime.cjs'))
  )
  worker = new PackWorker(pathToFileURL(join(scratch, 'pack-worker.cjs')))
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
    {
      id: 'tl',
      files: ['tl.jsonl'],
      words: ['bahay', 'tao', 'BAHAY', 'tubig', 'maganda'],
    },
  ]
  if (
    await stat(join(sources, 'fr.jsonl'))
      .then(() => true)
      .catch(() => false)
  )
    packs.push({
      id: 'fr',
      files: ['fr.jsonl'],
      words: ['maison', 'chat', 'MAISON', 'chien', 'eau'],
    })
  const requested = process.argv[4]?.split(',')
  if (requested?.some((id) => !packs.some((pack) => pack.id === id)))
    throw new Error('unknown or unavailable benchmark language')
  for (const pack of packs.filter(
    (pack) => !requested || requested.includes(pack.id),
  )) {
    const directory = await mkdtemp(join(output, `${pack.id}-`))
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
      const stats = await worker.convert(
        pack.id,
        paths,
        directory,
        new AbortController().signal,
        () => {},
      )
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
      const result = {
        id: pack.id,
        sourceFiles: pack.files,
        downloadBytes,
        ...stats,
        convertedBytes: stats.data.bytes + stats.index.bytes,
        firstLoadMs,
        coldFirstWordAfterLoadMs,
        warmP50Ms: times[49],
        warmP95Ms: times[94],
        warmMaxMs: times[99],
        firstWord: pack.words[0],
        firstWordResults: first.length,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    } catch (error) {
      const result = { id: pack.id, downloadBytes, error: error.message }
      results.push(result)
      console.log(JSON.stringify(result))
      process.exitCode = 1
    } finally {
      await worker.unload()
      await rm(directory, { recursive: true, force: true })
    }
    await writeFile(
      join(output, 'results.json'),
      `${JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          samples: 100,
          note: 'first-load includes index parsing; cold word means uncached record after load, not cleared OS cache',
          results,
        },
        null,
        2,
      )}\n`,
    )
  }
} finally {
  await worker?.close()
  await rm(scratch, { recursive: true, force: true })
}
