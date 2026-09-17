import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withCodSpeed } from '@codspeed/tinybench-plugin'
import { Bench } from 'tinybench'
import {
  benchmarkDocuments,
  launchBenchmarkApp,
  openBenchmarkDocument,
  selectBenchmarkFile,
  switchToSource,
  typeCharacter,
  waitForEditor,
  waitForWorkspaces,
} from '../../scripts/benchmark-flows.mjs'

// Native I/O needs walltime; simulation would measure the driver, not Electron.
if (
  ['simulation', 'instrumentation', 'memory'].includes(
    process.env.CODSPEED_RUNNER_MODE,
  )
)
  throw new Error('Run desktop benchmarks with CodSpeed walltime mode.')

const benchmarks = withCodSpeed(
  new Bench({
    time: 0,
    iterations: 5,
    warmupTime: 0,
    warmupIterations: 1,
    throws: true,
  }),
)
const root = await mkdtemp(join(tmpdir(), 'hibi-codspeed-'))
const recentPaths = ['notes', 'journal', 'projects'].map((name) =>
  join(root, name),
)
let warmProfile, profile, app, page, previousText

async function createProfile(prefix) {
  const path = await mkdtemp(join(root, prefix))
  await writeFile(
    join(path, 'recent-workspaces.json'),
    JSON.stringify(recentPaths),
  )
  return path
}
async function launch(profile) {
  app = await launchBenchmarkApp(profile)
  page = await app.firstWindow()
  await waitForEditor(page)
  await waitForWorkspaces(page, recentPaths)
}
async function cleanup() {
  try {
    await app?.close()
  } finally {
    app = null
    if (profile && profile !== warmProfile)
      await rm(profile, { recursive: true, force: true })
  }
}

try {
  for (const path of recentPaths) await mkdir(path)
  for (const document of benchmarkDocuments)
    await writeFile(join(root, document.name), document.source)
  warmProfile = await createProfile('warm-')

  for (const retained of [false, true]) {
    benchmarks.add(
      retained
        ? 'startup: retained profile to input and workspace list'
        : 'startup: fresh profile to input and workspace list',
      async () => {
        await launch(profile)
      },
      {
        beforeEach: async () => {
          profile = retained ? warmProfile : await createProfile('fresh-')
        },
        afterEach: cleanup,
      },
    )
  }
  benchmarks.add(
    'editor: first displayed keystroke',
    async () => {
      await typeCharacter(page, previousText)
    },
    {
      beforeEach: async () => {
        profile = await createProfile('input-')
        await launch(profile)
        previousText = await page
          .getByRole('textbox', { name: 'Document editor', exact: true })
          .textContent()
      },
      afterEach: cleanup,
    },
  )
  for (const document of benchmarkDocuments) {
    benchmarks.add(
      `editor: open ${document.name}`,
      async () => {
        await openBenchmarkDocument(app, page, document.title)
        await waitForEditor(page)
      },
      {
        beforeEach: async () => {
          profile = await createProfile('document-')
          await launch(profile)
          await selectBenchmarkFile(app, join(root, document.name))
        },
        afterEach: cleanup,
      },
    )
  }
  benchmarks.add(
    'editor: first source view after code-heavy note',
    async () => {
      await switchToSource(app, page)
    },
    {
      beforeEach: async () => {
        profile = await createProfile('source-')
        await launch(profile)
        const document = benchmarkDocuments[1]
        await selectBenchmarkFile(app, join(root, document.name))
        await openBenchmarkDocument(app, page, document.title)
        await waitForEditor(page)
      },
      afterEach: cleanup,
    },
  )
  // The retained profile's warmup launch is excluded from its five measured rounds.
  await benchmarks.run()
  console.table(benchmarks.table())
} finally {
  try {
    await cleanup()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
