import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { electron } from '../tests/electron.mjs'
import { clickMenu, pressShortcut } from '../tests/keyboard.mjs'

const runs = Number(process.env.HIBI_BENCH_RUNS ?? 5)
if (!Number.isInteger(runs) || runs < 1 || runs > 50)
  throw new Error('Use 1–50 runs.')
const temp = await mkdtemp(join(tmpdir(), 'hibi-benchmark-'))
const samples = []
const recentPaths = ['notes', 'journal', 'projects'].map((name) =>
  join(temp, name),
)
for (const path of recentPaths) await mkdir(path)
const enabledAddons = (process.env.HIBI_BENCH_ADDONS ?? '')
  .split(',')
  .filter(Boolean)
const documents =
  process.env.HIBI_BENCH_DOCUMENTS === '1'
    ? [
        {
          name: 'large.md',
          title: 'Large benchmark',
          source:
            '# Large benchmark\n\n' +
            'A paragraph for measuring document layout and keyboard input. **Bold** and _italic_.\n\n'.repeat(
              180,
            ),
        },
        {
          name: 'code.md',
          title: 'Code benchmark',
          source:
            '# Code benchmark\n\n' +
            [
              '```js\nconst answer = 42;\n```',
              '```rust\nfn main() { let answer = 42; }\n```',
              '```python\ndef answer():\n  return 42\n```',
              '```sql\nSELECT name FROM notes;\n```',
            ]
              .join('\n\n')
              .concat('\n\n')
              .repeat(20),
        },
      ]
    : []
for (const document of documents)
  await writeFile(join(temp, document.name), document.source)
const minimal = join(temp, 'minimal.cjs')
await writeFile(
  minimal,
  `const {app,BrowserWindow}=require('electron');
app.setPath('userData',app.commandLine.getSwitchValue('user-data-dir'));
app.whenReady().then(()=>{ const win=new BrowserWindow({width:1000,height:720,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.loadURL('data:text/html,<body contenteditable="true" role="textbox" aria-label="Document editor"></body>'); });
app.on('window-all-closed',()=>app.quit());`,
)

async function measure(page, start, app, scenario) {
  const editor = page.getByRole('textbox', {
    name: 'Document editor',
    exact: true,
  })
  // Frame polling avoids locator retry backoff being counted as startup latency.
  await page.waitForFunction(() => {
    const editor = document.querySelector(
      '[role="textbox"][aria-label="Document editor"]',
    )
    return (
      editor?.isContentEditable &&
      !editor.closest('[inert]') &&
      editor.getBoundingClientRect().width > 0
    )
  })
  const editable = performance.now() - start
  let ready = null
  if (
    ['fresh-profile', 'warm-profile', 'warm-profile-prime'].includes(scenario)
  ) {
    await page.waitForFunction((paths) => {
      const buttons = [
        ...document.querySelectorAll('.startup-placeholder li button'),
      ]
      return (
        buttons.length === paths.length &&
        buttons.every(
          (button, index) =>
            button.textContent === paths[index] &&
            !button.disabled &&
            !button.closest('[inert]'),
        )
      )
    }, recentPaths)
    ready = performance.now() - start
  }
  const previousText = await editor.textContent()
  const beforeInput = performance.now()
  await editor.press('x')
  await page.waitForFunction(
    (previous) =>
      document.querySelector('[role="textbox"][aria-label="Document editor"]')
        ?.textContent !== previous,
    previousText,
  )
  const firstInput = performance.now() - beforeInput
  const typing = []
  for (let i = 0; i < 8; i++) {
    const before = performance.now()
    await editor.press('a')
    typing.push(performance.now() - before)
    await new Promise((done) => setTimeout(done, 50))
  }
  const renderer = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    spans: performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('hibi:'))
      .map((entry) => ({
        name: entry.name,
        ms: entry.startTime,
        duration: entry.duration,
      })),
    milestones: performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('hibi:'))
      .map((entry) => ({ name: entry.name, ms: entry.startTime })),
    paint: performance
      .getEntriesByType('paint')
      .map((entry) => ({ name: entry.name, ms: entry.startTime })),
    sourceMounted: !!document.querySelector('.cm-editor'),
  }))
  // Custom-scheme scripts are absent from Resource Timing on some Electron versions.
  // Attach only after latency samples so debugger work does not affect those timings.
  const session = await page.context().newCDPSession(page)
  renderer.scripts = []
  session.on('Debugger.scriptParsed', ({ url }) => {
    if (url.startsWith('app://hibi/')) renderer.scripts.push(url)
  })
  await session.send('Debugger.enable')
  await session.detach()
  const main = await app.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    entries: performance
      .getEntries()
      .filter((entry) => entry.name.startsWith('hibi:'))
      .map((entry) => ({
        name: entry.name,
        ms: entry.startTime,
        duration: entry.duration,
      })),
  }))
  samples.push({
    scenario,
    startedAt: performance.timeOrigin + start,
    editable,
    ready,
    firstInput,
    typing,
    renderer,
    main,
  })
}

try {
  for (const scenario of ['minimal', 'fresh-profile', 'warm-profile']) {
    for (let run = 0; run < runs; run++) {
      const profile = join(
        temp,
        scenario === 'warm-profile' ? 'warm' : `${scenario}-${run}`,
      )
      await mkdir(profile, { recursive: true })
      if (scenario !== 'minimal')
        await writeFile(
          join(profile, 'recent-workspaces.json'),
          JSON.stringify(recentPaths),
        )
      if (scenario !== 'minimal' && enabledAddons.length)
        await writeFile(
          join(profile, 'addons.json'),
          JSON.stringify(
            Object.fromEntries(enabledAddons.map((id) => [id, true])),
          ),
        )
      const start = performance.now()
      const app = await electron.launch({
        args: [
          scenario === 'minimal' ? minimal : resolve('.'),
          `--user-data-dir=${profile}`,
        ],
      })
      try {
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1 })
        })
        await measure(
          await app.firstWindow(),
          start,
          app,
          scenario === 'warm-profile' && run === 0
            ? 'warm-profile-prime'
            : scenario,
        )
        if (scenario === 'fresh-profile' && process.platform === 'darwin') {
          await app.evaluate(
            ({ BrowserWindow }) =>
              new Promise((resolve) => {
                const window = BrowserWindow.getAllWindows()[0]
                window.once('closed', () => resolve())
                window.close()
              }),
          )
          const reopening = performance.now()
          const window = app.waitForEvent('window')
          await app.evaluate(({ app }) => app.emit('activate'))
          await measure(await window, reopening, app, 'window-reopen')
        }
        if (scenario === 'fresh-profile') {
          const page = await app.firstWindow()
          for (const document of documents) {
            await app.evaluate(
              ({ dialog }, file) => {
                dialog.showOpenDialog = async () => ({
                  canceled: false,
                  filePaths: [file],
                })
              },
              join(temp, document.name),
            )
            const opening = performance.now()
            await clickMenu(app, 'Open…')
            await page.waitForFunction(
              (title) =>
                [...document.querySelectorAll('.tiptap h1')].some(
                  (heading) => heading.textContent === title,
                ),
              document.title,
            )
            await measure(page, opening, app, `document-open:${document.name}`)
          }
          if (documents.length) {
            const switching = performance.now()
            await pressShortcut(
              app,
              `${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+]`,
            )
            await page.waitForFunction(() => {
              const pane = document.querySelector('.source-pane')
              const editor = pane?.querySelector('.cm-content')
              return (
                editor?.isContentEditable &&
                document.querySelector('.editor-panes')?.dataset.sourceReady ===
                  'true' &&
                getComputedStyle(pane).visibility === 'visible' &&
                Number(getComputedStyle(pane).opacity) === 1 &&
                Number(getComputedStyle(pane.parentElement).opacity) === 1
              )
            })
            samples.at(-1).firstSourceSwitch = performance.now() - switching
          }
        }
      } finally {
        await app.close()
      }
    }
  }
  const chunks = JSON.parse(
    await readFile('out/renderer/startup-bundle.json', 'utf8'),
  )
  const visited = new Set()
  function visit(file) {
    if (visited.has(file)) return
    const chunk = chunks.find((chunk) => chunk.file === file)
    if (!chunk) return
    visited.add(file)
    for (const dependency of chunk.imports) visit(dependency)
  }
  for (const entry of chunks.filter((chunk) => chunk.entry)) visit(entry.file)
  const initial = chunks.filter((chunk) => visited.has(chunk.file))
  const quantile = (values, q) =>
    values.toSorted((a, b) => a - b)[Math.ceil(values.length * q) - 1]
  const summary = [...new Set(samples.map((sample) => sample.scenario))].map(
    (scenario) => {
      const group = samples.filter((sample) => sample.scenario === scenario)
      return {
        scenario,
        runs: group.length,
        editableMedian: quantile(
          group.map((sample) => sample.editable),
          0.5,
        ),
        editableP95: quantile(
          group.map((sample) => sample.editable),
          0.95,
        ),
        readyMedian:
          quantile(
            group.flatMap((sample) =>
              sample.ready === null ? [] : [sample.ready],
            ),
            0.5,
          ) ?? null,
        readyP95:
          quantile(
            group.flatMap((sample) =>
              sample.ready === null ? [] : [sample.ready],
            ),
            0.95,
          ) ?? null,
        firstInputP95: quantile(
          group.map((sample) => sample.firstInput),
          0.95,
        ),
        typingP95: quantile(
          group.flatMap((sample) => sample.typing),
          0.95,
        ),
      }
    },
  )
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        enabledAddons,
        conditions:
          'Production assets in test Electron; fresh profile is not OS cold-cache; hidden windows; automation latency included.',
        initialBytes: initial.reduce((sum, chunk) => sum + chunk.bytes, 0),
        initialModules: initial.flatMap((chunk) => chunk.modules),
        summary,
        samples,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(temp, { recursive: true, force: true })
}
