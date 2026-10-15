import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { showTestWindows } from './electron.mjs'
import { waitForAsync } from './poll.mjs'

test('development watches main, renderer, preload, addons, and documentation generation', {
  timeout: 180000,
}, async (t) => {
  const started = performance.now()
  let output = ''
  const seenEndpoints = []
  const events = []
  const counts = {
    bytes: 0,
    events: 0,
    dropped: 0,
    clipped: 0,
    saturated: 0,
    live: 0,
  }
  let tail = Buffer.alloc(0)
  let pendingPhase = 'copy fixture'
  let phaseAt = 0
  let lastChildAt = null
  let childPid = null
  let childExitCode = null
  let childSignal = null
  let cachedDiagnostic = ''
  let completed = false
  function byteTail(text, limit) {
    const bytes = Buffer.from(text)
    let start = Math.max(0, bytes.length - limit)
    while ((bytes[start] & 0xc0) === 0x80) start++
    return bytes.toString('utf8', start)
  }
  function byteHead(text, limit) {
    const bytes = Buffer.from(text)
    let end = Math.min(bytes.length, limit)
    while ((bytes[end] & 0xc0) === 0x80) end--
    return bytes.toString('utf8', 0, end)
  }
  function refreshDiagnostic() {
    const header = byteTail(
      `cached snapshot (elapsed ms, not abort time): phase=${pendingPhase}; phaseAt=${phaseAt}; snapshotAt=${Math.round(performance.now() - started)}; lastChildAt=${lastChildAt ?? 'none'}; pid=${childPid ?? 'none'}; exit=${childExitCode ?? 'none'}; signal=${childSignal ?? 'none'}; endpoints=${seenEndpoints.length}; tailOmitted=${counts.bytes - tail.length}; counts=${JSON.stringify(counts)}`,
      1024,
    )
    cachedDiagnostic = byteTail(
      `${header}\n${counts.dropped ? `[events dropped: ${counts.dropped}]\n` : ''}${events.join('\n')}\nchild tail:\n${byteTail(tail.toString('utf8'), 4096)}`,
      16384,
    )
  }
  function phase(label) {
    pendingPhase = label
    phaseAt = Math.round(performance.now() - started)
    refreshDiagnostic()
  }
  phase('copy fixture')
  t.signal.addEventListener(
    'abort',
    () => {
      if (completed) return
      try {
        console.error(cachedDiagnostic)
      } catch {}
    },
    { once: true },
  )
  const mark = (message) =>
    t.diagnostic(`${message} (${Math.round(performance.now() - started)} ms)`)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hibi-dev-watch-')))
  for (const name of [
    'src',
    'scripts',
    'docs',
    'build',
    'package.json',
    'package-lock.json',
    'electron.vite.config.ts',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.web.json',
  ])
    await cp(resolve(name), join(root, name), {
      recursive: true,
      filter: (file) => !file.split(sep).includes('useraddons'),
    })
  mark('fixture source copied')
  phase('configure fixture')
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction')
  const previewFolder = join(root, 'src/addons/ui-preview')
  const previewManifest = join(previewFolder, 'hibi-addon.json')
  await writeFile(
    previewManifest,
    JSON.stringify(
      {
        ...JSON.parse(await readFile(previewManifest, 'utf8')),
        entry: 'window.tsx',
        native: { entry: 'host.ts' },
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(previewFolder, 'host.ts'),
    "export default { id: 'ui-preview', queries: { probe: async () => 'owner-native' }, methods: {} }",
  )
  await writeFile(
    join(previewFolder, 'window.tsx'),
    `
      import { createElement } from 'react'
      import original from './index'
      const owner = location.pathname.endsWith('/addon-window.html')
      const probe = owner ? (window.catalogWindowProbe = {
        sealed: window.hibiAddonWindow.seal() === undefined,
        desktop: typeof window.hibi,
        closed: window.hibiAddonWindow.query('probe').then(() => false, error => /bridge is closed/.test(error.message)),
        factories: 0, starts: 0,
      }) : undefined
      export default () => {
        if (probe) probe.factories++
        const { manifest, ...definition } = original
        return {
          ...definition,
          start(context) {
            if (probe) probe.starts++
            return original.start(context)
          },
          windows: {
            ...original.windows,
            preview(props) {
              if (probe) probe.native ??= props.native.query('probe')
              return createElement(original.windows.preview, props)
            },
          },
        }
      }
    `,
  )
  const holdMainBuild = join(root, 'hold-main-build')
  const mainBuildPaused = join(root, 'main-build-paused')
  const releaseMainBuild = join(root, 'release-main-build')
  const holdPreloadBuild = join(root, 'hold-preload-build')
  const preloadBuildPaused = join(root, 'preload-build-paused')
  const releasePreloadBuild = join(root, 'release-preload-build')
  const configPath = join(root, 'electron.vite.config.ts')
  const configSource = await readFile(configPath, 'utf8')
  for (const marker of [
    'licenseBuild = Promise.allSettled([writeLicenses()])',
    'analysisBundles(),',
    'plugins: [sandboxPreloads()],',
  ])
    assert.equal(
      configSource.split(marker).length,
      2,
      `config probe anchor: ${marker}`,
    )
  const outputProbeSource = String.raw`function outputProbe(label: string) {
  let builds = 0, active = false, lines = 0, ticks = 0, calls = 0, running = 0
  let stage = 'graph', last = 0, cpu = process.cpuUsage(), slow = '', slowMs = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let settings = ''
  const pending = new Map<number, { name: string, at: number, chars: number }>()
  const clean = (value: unknown, limit: number) =>
    String(value).replace(/[^\w:./=-]/g, '_').slice(0, limit)
  function show(message: string) {
    if (!active || ++lines > 24) return
    hookTiming('out', label, lines === 24 ? 'clipped' : message)
  }
  function report(next = stage) {
    if (!active) return
    const now = performance.now(), usage = process.cpuUsage()
    show(stage + (next === stage ? '' : '=>' + next) + ' w=' + Math.round(now - last) +
      ' c=' + Math.round((usage.user - cpu.user + usage.system - cpu.system) / 1000) +
      ' p=' + running + ' u=' + (running - pending.size))
    last = now
    cpu = usage
    stage = next
    const entry = pending.values().next().value
    if (entry) show('a=' + Math.round(now - entry.at) + ' n=' + entry.chars + ' ' + entry.name)
    else if (slow) show('slow ' + slow + ' ms=' + slowMs)
  }
  function change(next: string) {
    if (!active || stage === next) return
    report(next)
  }
  function stop(next: string) {
    change(next)
    active = false
    clearInterval(timer)
  }
  return {
    name: 'dev-watch-output-' + label,
    configResolved(config: any) {
      settings = 'target=' + clean(config.build.target, 20) +
        ' min=' + clean(config.build.minify, 5) + ' map=' + clean(config.build.sourcemap, 5)
      let wrapped = 0, unwrapped = 0
      for (const hookName of ['renderChunk', 'generateBundle', 'writeBundle']) {
        for (const plugin of config.plugins) {
          if (plugin.name.startsWith('dev-watch-output-')) continue
          const hook = plugin[hookName]
          const handler = typeof hook === 'function' ? hook : hook?.handler
          if (typeof handler !== 'function') continue
          if (wrapped === 32) { unwrapped++; continue }
          wrapped++
          const name = clean(plugin.name.replace(/^vite:/, ''), 12) + '/' + hookName[0]
          const wrappedHook = function(this: unknown, ...args: any[]) {
            if (!active) return handler.apply(this, args)
            if (hookName !== 'renderChunk') change(hookName === 'generateBundle' ? 'generate' : 'writes')
            const call = ++calls, at = performance.now()
            const chunk = hookName === 'renderChunk'
              ? '/' + clean(args[1].name || args[1].fileName, 7) : ''
            const callName = name + chunk
            running++
            if (pending.size < 16) pending.set(call, {
              name: callName, at, chars: hookName === 'renderChunk' ? args[0].length : 0,
            })
            const finish = () => {
              try {
                running--
                pending.delete(call)
                const elapsed = Math.round(performance.now() - at)
                if (elapsed > slowMs) { slowMs = elapsed; slow = callName }
              } catch {}
            }
            let result
            try { result = handler.apply(this, args) }
            catch (error) { finish(); throw error }
            if (result instanceof Promise) result.then(finish, finish)
            else finish()
            return result
          }
          plugin[hookName] = typeof hook === 'function'
            ? wrappedHook : { ...hook, handler: wrappedHook }
        }
      }
      settings += ' wrap=' + wrapped + ' omitted=' + unwrapped
    },
    buildStart() {
      if (++builds !== 1) return
      active = true
      last = performance.now()
      cpu = process.cpuUsage()
      show('pid=' + process.pid + ' u=' + cpu.user + ' s=' + cpu.system)
      show('exec=' + clean(process.execPath, 64))
      show(settings)
      report()
    },
    buildEnd(error: unknown) {
      change('buildEnd')
      if (error) stop('graph-error')
    },
    renderStart: { order: 'pre', handler() {
      change('core')
      if (!active) return
      timer = setInterval(() => {
        report()
        if (++ticks === 12) clearInterval(timer)
      }, 4000)
      timer.unref()
    } },
    renderChunk: { order: 'pre', handler() { change('chunks') } },
    generateBundle: { order: 'post', handler() { change('gap') } },
    writeBundle() { change('writes') },
    renderError() { stop('render-error') },
    closeBundle() { stop('closeBundle') },
    closeWatcher() { stop('closeWatcher') },
  }
}
`
  const config = `let timingLines = 0, timingCalls = 0
function hookTiming(...fields: unknown[]) {
  if (++timingLines > 96) return
  try { console.log('[dev-watch]', ...(timingLines === 96 ? ['clipped'] : fields)) } catch {}
}
function timedHook(label: string, hook: Function) {
  return function(this: unknown, ...args: unknown[]) {
    if (label === 'analysis' && args[0] !== '\\0virtual:hibi-analysis')
      return hook.apply(this, args)
    const call = ++timingCalls, start = performance.now()
    hookTiming(label, call, 'start')
    return (async () => {
      try { return await hook.apply(this, args) }
      finally { hookTiming(label, call, 'end', Math.round(performance.now() - start)) }
    })()
  }
}
${outputProbeSource}\n${configSource}`
    .replace(
      'licenseBuild = Promise.allSettled([writeLicenses()])',
      "licenseBuild = Promise.allSettled([timedHook('licenses', writeLicenses)()])",
    )
    .replace(
      'analysisBundles(),',
      `(() => {
        const plugin = analysisBundles()
        plugin.load = timedHook('analysis', plugin.load)
        return plugin
      })(),
      outputProbe('main'),
      {
        name: 'hold-main-rebuild',
        async writeBundle() {
          const fs = await import('node:fs/promises')
          try { await fs.access(${JSON.stringify(holdMainBuild)}) } catch { return }
          await fs.writeFile(${JSON.stringify(mainBuildPaused)}, '')
          while (true) {
            try { await fs.access(${JSON.stringify(releaseMainBuild)}); return } catch {}
            await new Promise((done) => setTimeout(done, 50))
          }
        },
      },`,
    )
    .replace(
      'plugins: [sandboxPreloads()],',
      `plugins: [
      sandboxPreloads(),
      outputProbe('preload'),
      (() => {
        let builds = 0
        return {
          name: 'hold-preload-rebuild',
          async generateBundle() {
            const fs = await import('node:fs/promises')
            try { await fs.access(${JSON.stringify(holdPreloadBuild)}) } catch { return }
            if (++builds !== 2) return
            await fs.writeFile(${JSON.stringify(preloadBuildPaused)}, '')
            while (true) {
              try { await fs.access(${JSON.stringify(releasePreloadBuild)}); return } catch {}
              await new Promise((done) => setTimeout(done, 50))
            }
          },
        }
      })(),
    ],`,
    )
  assert.ok(config.includes("name: 'hold-main-rebuild'"))
  assert.ok(config.includes("name: 'hold-preload-rebuild'"))
  await writeFile(
    configPath,
    config.replace(
      "server: { host: '127.0.0.1' }",
      `server: { host: '127.0.0.1', fs: { allow: ${JSON.stringify([root, resolve('node_modules')])} } }`,
    ),
  )
  const devPath = join(root, 'scripts/dev.mjs')
  const devSource = await readFile(devPath, 'utf8')
  for (const marker of [
    'const env = await electronEnvironment()',
    'const site = fork(',
    '  desktop = spawn(',
  ])
    assert.equal(
      devSource.split(marker).length,
      2,
      `launcher probe anchor: ${marker}`,
    )
  await writeFile(
    devPath,
    devSource
      .replace(
        'const env = await electronEnvironment()',
        `function devWatchMark(message) {
  try { console.log('[dev-watch]', message) } catch {}
}
devWatchMark('runtime-await-start')
const env = await electronEnvironment()
devWatchMark('runtime-await-end')`,
      )
      .replace(
        'const site = fork(',
        "devWatchMark('site-fork')\nconst site = fork(",
      )
      .replace(
        '  desktop = spawn(',
        "  devWatchMark('site-ready')\n  devWatchMark('desktop-spawn')\n  desktop = spawn(",
      ),
  )
  const cancelNextClose = join(root, 'cancel-next-close')
  const closePromptCanceled = join(root, 'close-prompt-canceled')
  const documentPath = join(root, 'src/main/document.ts')
  const documentSource = await readFile(documentPath, 'utf8')
  const documentImport =
    "import { app, type BrowserWindow, dialog } from 'electron'"
  assert.ok(documentSource.includes(documentImport))
  await writeFile(
    documentPath,
    documentSource.replace(
      documentImport,
      `${documentImport}
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'

const showMessageBox = dialog.showMessageBox.bind(dialog)
dialog.showMessageBox = (...args) => {
  const options = args.at(-1)
  if (options?.message?.startsWith('Save changes to ') && existsSync(${JSON.stringify(cancelNextClose)})) {
    unlinkSync(${JSON.stringify(cancelNextClose)})
    writeFileSync(${JSON.stringify(closePromptCanceled)}, '')
    return Promise.resolve({ response: 2, checkboxChecked: false })
  }
  return showMessageBox(...args)
}`,
    ),
  )
  const profile = join(root, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ 'typing-speed': true }),
  )
  mark('fixture configured')
  phase('start dev child')
  const pendingLines = { stdout: '', stderr: '' }
  const child = spawn(
    process.execPath,
    [
      'scripts/dev.mjs',
      '--',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      `--user-data-dir=${profile}`,
      ...(showTestWindows ? [] : ['--hibi-test']),
    ],
    {
      cwd: root,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        REMOTE_DEBUGGING_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  childPid = child.pid ?? null
  lastChildAt = Math.round(performance.now() - started)
  refreshDiagnostic()
  child.once('exit', (code, signal) => {
    childExitCode = code
    childSignal = signal
    lastChildAt = Math.round(performance.now() - started)
    refreshDiagnostic()
  })
  const collect = (data, stream) => {
    lastChildAt = Math.round(performance.now() - started)
    counts.bytes += data.length
    tail = Buffer.concat([tail, data.subarray(-4096)]).subarray(-4096)
    const chunk = data.toString()
    output = (output + chunk).slice(-256000)
    const lines = (pendingLines[stream] + chunk).split(/\r?\n/)
    pendingLines[stream] = lines.pop()
    for (const line of lines) {
      const endpoint = line.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]
      if (endpoint && !seenEndpoints.includes(endpoint))
        seenEndpoints.push(endpoint)
      if (
        /\[dev-watch\]|build started|built in|restart|reloading|DevTools listening|modules transformed|rendering chunks|computing gzip size/.test(
          line,
        )
      ) {
        const knownProbe =
          /^\[dev-watch\] (?:(?:licenses|analysis) \d+ (?:start|end \d+)|clipped|runtime-await-start|runtime-await-end|site-fork|site-ready|desktop-spawn|out (?:main|preload) [\w:./=> -]{1,128})$/.test(
            line,
          )
        if (
          knownProbe &&
          counts.live < 101 &&
          !completed &&
          !t.signal.aborted
        ) {
          counts.live++
          mark(byteHead(line, 96))
        }
        counts.events++
        if (line.includes('[dev-watch] clipped')) counts.saturated++
        if (Buffer.byteLength(line) > 64) counts.clipped++
        const hook = line.match(
          /\[dev-watch\] (licenses|analysis) \d+ (start|end)/,
        )
        if (hook) {
          const key = `${hook[1]}-${hook[2]}`
          counts[key] = (counts[key] ?? 0) + 1
        }
        if (events.length === 96) {
          events.splice(24, 1)
          counts.dropped++
        }
        events.push(
          byteHead(
            `${Math.round(performance.now() - started)} ${stream} ${byteHead(line, 64)}`,
            96,
          ),
        )
      }
    }
    refreshDiagnostic()
  }
  child.stdout.on('data', (data) => collect(data, 'stdout'))
  child.stderr.on('data', (data) => collect(data, 'stderr'))
  let browser
  t.after(async () => {
    if (process.platform === 'win32') {
      await new Promise((done) =>
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']).once(
          'close',
          done,
        ),
      )
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((done) => child.once('close', done))
    await browser?.close().catch(() => {})
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  })
  async function until(predicate, label, timeout = 20000) {
    phase(label)
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await predicate()) return
      await delay(100)
    }
    assert.fail(`${label}\n${output.slice(-2500)}`)
  }
  async function replace(file, before, after) {
    const path = join(root, file)
    const original = await readFile(path, 'utf8')
    assert.ok(original.includes(before), `${file}: marker exists`)
    await writeFile(path, original.replace(before, after))
  }
  await until(() => seenEndpoints.length > 0, 'dev app starts', 60000)
  mark('first devtools endpoint')
  phase('connect first devtools')
  browser = await chromium.connectOverCDP(seenEndpoints[0])
  let page = browser.contexts()[0].pages()[0]
  page.setDefaultTimeout(30000)
  phase('initial renderer readiness')
  await page.locator('[data-status-id="typing-speed.wpm"]').waitFor()
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.hibi.getAddonStates()).find(
          (entry) => entry.id === 'diagnostics',
        ).enabled,
    ),
    true,
  )
  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .fill('unsaved watch draft')
  await waitForAsync(
    page,
    async () =>
      (await window.hibi.getDocument()).markdown === 'unsaved watch draft',
  )
  await replace(
    'src/renderer/src/Titlebar.tsx',
    'aria-label="Editor view"',
    'aria-label="Updated editor view"',
  )
  await page.getByRole('navigation', { name: 'Updated editor view' }).waitFor()
  mark('renderer component updated')
  const css = join(root, 'src/renderer/src/styles.css')
  await writeFile(
    css,
    `${await readFile(css, 'utf8')}\nbody { --dev-watch-probe: updated; }\n`,
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(document.body)
        .getPropertyValue('--dev-watch-probe')
        .trim() === 'updated',
  )
  mark('renderer stylesheet updated')
  let viteConnections = 0
  const viteEvents = []
  const onViteSocket = (socket) => {
    if (!socket.url().includes('?token=')) return
    viteEvents.push(`created ${socket.url().split('?')[0]}`)
    socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('"type":"connected"')) {
        viteConnections++
        viteEvents.push('connected')
      }
    })
  }
  page.on('websocket', onViteSocket)
  await replace(
    'src/addons/typing-speed/index.ts',
    'This estimates how many words you type per minute.',
    'Updated typing speed runtime.',
  )
  await page.waitForFunction(() =>
    document
      .querySelector('[data-status-id="typing-speed.wpm"]')
      ?.getAttribute('data-tooltip')
      ?.startsWith('Updated typing speed runtime.'),
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'unsaved watch draft',
  )
  mark('addon runtime updated and draft retained')
  // The addon change reloads the page; a preload rebuild must reach its new Vite socket.
  await until(
    () => viteConnections > 0,
    'vite websocket reconnects after addon reload',
  ).catch((error) => {
    t.diagnostic(`vite websocket events: ${viteEvents.join(', ') || 'none'}`)
    throw error
  })
  const preload = join(root, 'src/preload/index.ts')
  const preloadSource = await readFile(preload, 'utf8')
  const preloadUrl = page.url()
  const previousConnections = viteConnections
  let heldNavigation
  let releaseNavigation
  const navigationGate = new Promise((resolve) => {
    releaseNavigation = resolve
  })
  const holdFirstReload = async (route) => {
    if (route.request().isNavigationRequest() && !heldNavigation) {
      heldNavigation = route
      await navigationGate
    }
    await route.continue()
  }
  await page.route(preloadUrl, holdFirstReload)
  await writeFile(holdPreloadBuild, '')
  try {
    await writeFile(
      preload,
      `${preloadSource}\ncontextBridge.exposeInMainWorld('devWatchProbe', 'previous')\n`,
    )
    await until(() => !!heldNavigation, 'first preload reload starts')
    await writeFile(
      preload,
      `${preloadSource}\ncontextBridge.exposeInMainWorld('devWatchProbe', 'updated')\n`,
    )
    await until(async () => {
      try {
        await access(preloadBuildPaused)
        return true
      } catch {
        return false
      }
    }, 'second preload build reaches output generation')
    // Navigate while the next build has prepared its output but cannot write it.
    const loaded = page.waitForEvent('domcontentloaded')
    releaseNavigation()
    await loaded
    assert.deepEqual(
      await page.evaluate(() => ({
        bridge: typeof window.hibi,
        probe: window.devWatchProbe,
      })),
      { bridge: 'object', probe: 'previous' },
      'reloading during a preload rebuild keeps the previous bridge',
    )
    await until(
      () => viteConnections > previousConnections,
      'vite websocket reconnects before the second preload build finishes',
    )
  } finally {
    releaseNavigation()
    await writeFile(releasePreloadBuild, '')
    await page.unroute(preloadUrl, holdFirstReload)
    page.off('websocket', onViteSocket)
  }
  await page
    .waitForFunction(() => window.devWatchProbe === 'updated')
    .catch((error) => {
      assert.fail(
        `preload did not update: ${error.message}\n${output.slice(-2500)}`,
      )
    })
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'unsaved watch draft',
  )
  const appUrl = page.url()
  for (const target of [
    'https://example.com/',
    new URL('/other.html', appUrl).href,
    `${appUrl}?other-page`,
  ]) {
    assert.equal(
      await page.evaluate(
        (url) =>
          new Promise((done) => {
            location.href = url
            setTimeout(() => done(location.href), 100)
          }),
        target,
      ),
      appUrl,
    )
  }
  mark('preload updated, draft retained, other navigation blocked')
  await page.evaluate(() => window.hibi.setAddonEnabled('diagnostics', false))
  await page.reload()
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.hibi.getAddonStates()).find(
          (entry) => entry.id === 'diagnostics',
        ).enabled,
    ),
    false,
  )
  async function clearDraft(expected) {
    phase(`clear draft: ${expected}`)
    if (showTestWindows) {
      await page.bringToFront()
      await page.evaluate(() => window.focus())
    }
    await page
      .waitForFunction((expected) => {
        const editor = document.querySelector(
          '[role="textbox"][aria-label="Document editor"]',
        )
        const panel = editor?.closest('.editor-page')
        return (
          editor?.textContent === expected &&
          editor.getAttribute('contenteditable') === 'true' &&
          editor.getAttribute('aria-readonly') === 'false' &&
          panel?.getAttribute('aria-busy') === 'false' &&
          !panel.hasAttribute('inert')
        )
      }, expected)
      .catch(async (error) => {
        const state = await page.evaluate(async () => {
          const editor = document.querySelector(
            '[role="textbox"][aria-label="Document editor"]',
          )
          const panel = editor?.closest('.editor-page')
          return {
            native: await window.hibi.getDocument(),
            editor: editor?.outerHTML.slice(0, 300),
            busy: panel?.getAttribute('aria-busy'),
            inert: panel?.hasAttribute('inert'),
            windowFocused: document.hasFocus(),
          }
        })
        assert.fail(
          `draft editor never became ready: ${error.message}\n${JSON.stringify(state)}`,
        )
      })
    await page.evaluate(() => {
      const trace = {
        nodes: new WeakMap(),
        next: 0,
        events: [],
      }
      window.__devReloadInputTrace = trace
      for (const type of ['beforeinput', 'input'])
        document.addEventListener(
          type,
          (event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest('[aria-label="Document editor"]')
            )
              return
            const record = {
              type,
              inputType: event.inputType,
              prevented: event.defaultPrevented,
            }
            trace.events.push(record)
            if (type === 'beforeinput')
              queueMicrotask(() => {
                record.prevented = event.defaultPrevented
              })
          },
          true,
        )
    })
    const inspect = () =>
      page.evaluate(async () => {
        const editor = document.querySelector(
          '[role="textbox"][aria-label="Document editor"]',
        )
        const panel = editor?.closest('.editor-page')
        const trace = window.__devReloadInputTrace
        if (editor && trace && !trace.nodes.has(editor))
          trace.nodes.set(editor, ++trace.next)
        const native = await window.hibi.getDocument()
        return {
          pageEpoch: performance.timeOrigin,
          editorNode: editor && trace?.nodes.get(editor),
          windowFocused: document.hasFocus(),
          activeElement: document.activeElement?.getAttribute('aria-label'),
          native: {
            markdown: native.markdown,
            contentVersion: native.contentVersion,
            dirty: native.dirty,
          },
          editor: {
            text: editor?.textContent,
            html: editor?.innerHTML,
            contenteditable: editor?.getAttribute('contenteditable'),
            readonly: editor?.getAttribute('aria-readonly'),
            connected: editor?.isConnected,
          },
          panel: {
            busy: panel?.getAttribute('aria-busy'),
            inert: panel?.hasAttribute('inert'),
          },
          sourceReady: document
            .querySelector('.editor-panes')
            ?.getAttribute('data-source-ready'),
          notices: [...document.querySelectorAll('.document-notice')].map(
            (notice) => notice.textContent,
          ),
          events: trace?.events.slice(-8) ?? [],
        }
      })
    const before = await inspect()
    const editor = page.getByRole('textbox', {
      name: 'Document editor',
      exact: true,
    })
    await editor.focus()
    await page
      .waitForFunction(
        (needsWindowFocus) =>
          (!needsWindowFocus || document.hasFocus()) &&
          document.activeElement?.closest('[aria-label="Document editor"]'),
        showTestWindows,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        assert.fail(
          `draft editor never received focus: ${error.message}\n${JSON.stringify(await inspect())}`,
        )
      })
    phase('clear draft keystrokes')
    // Send an editor keystroke: fill('') can skip deletion after a dev reload.
    await editor.press('ControlOrMeta+A')
    await editor.press('Backspace')
    const afterInput = await inspect()
    phase('clear draft flush')
    await page.evaluate(() => window.hibi.flushDocumentChanges())
    const afterFlush = await inspect()
    phase('confirm cleared draft')
    try {
      await waitForAsync(page, async () => {
        const document = await window.hibi.getDocument()
        return (
          document.markdown === '' &&
          !document.dirty &&
          document.tabs.every((tab) => !tab.dirty)
        )
      })
    } catch (error) {
      const state = await inspect()
      assert.fail(
        `draft did not clear: ${error.message}\n${JSON.stringify({ before, afterInput, afterFlush, state })}`,
      )
    }
  }
  // Main rebuild restarts Electron; close the draft without a discard prompt.
  await clearDraft('unsaved watch draft')
  async function connectRestartedPage(previousStarts) {
    await until(
      () => seenEndpoints.length > previousStarts,
      'main process restarts after rebuild',
      60000,
    ).catch(() => {
      assert.fail(
        `main process did not restart; ${seenEndpoints.length} devtools endpoints seen\n${output.slice(-2500)}`,
      )
    })
    let lastCdpError
    await until(
      async () => {
        try {
          browser = await chromium.connectOverCDP(seenEndpoints.at(-1), {
            timeout: 1000,
          })
          return true
        } catch (error) {
          lastCdpError = error
          return false
        }
      },
      'restarted devtools is available',
      15000,
    ).catch(() => {
      assert.fail(
        `restarted devtools is unavailable: ${lastCdpError instanceof Error ? lastCdpError.message : String(lastCdpError)}\n${output.slice(-1000)}`,
      )
    })
    await until(
      () => browser.contexts()[0]?.pages()[0],
      'restarted app opens a page',
    )
    page = browser.contexts()[0].pages()[0]
    phase('restarted renderer bridge')
    await page.waitForFunction(() => Boolean(window.hibi))
  }
  const initialStarts = seenEndpoints.length
  await writeFile(holdMainBuild, '')
  await replace(
    'src/main/imports.ts',
    "instructions: '',",
    "instructions: 'Updated folder importer.',",
  )
  await until(
    () =>
      access(mainBuildPaused).then(
        () => true,
        () => false,
      ),
    'main rebuild writes output before restart',
    60000,
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    '',
    'running main process still loads its original importer chunk',
  )
  await writeFile(releaseMainBuild, '')
  await connectRestartedPage(initialStarts)
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    'Updated folder importer.',
  )
  mark('main rebuild keeps old importer code until restart')

  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .fill('draft protected from restart')
  await waitForAsync(page, async () => {
    const document = await window.hibi.getDocument()
    return (
      document.markdown === 'draft protected from restart' &&
      document.dirty &&
      document.tabs.some((tab) => tab.dirty)
    )
  })
  const canceledStarts = seenEndpoints.length
  await writeFile(cancelNextClose, '')
  await replace(
    'src/main/imports.ts',
    "instructions: 'Updated folder importer.',",
    "instructions: 'Canceled rebuild importer.',",
  )
  await until(
    () =>
      access(closePromptCanceled).then(
        () => true,
        () => false,
      ),
    'save prompt canceled on dev restart',
    60000,
  )
  await until(
    () => output.includes('electron restart canceled; keeping current app'),
    'watcher acknowledges canceled restart',
    60000,
  )
  assert.equal(seenEndpoints.length, canceledStarts)
  assert.equal(
    (await page.evaluate(() => window.hibi.getDocument())).markdown,
    'draft protected from restart',
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    'Updated folder importer.',
  )
  mark('canceled restart keeps running app and dirty draft')

  await clearDraft('draft protected from restart')
  phase('write clean restart importer')
  await replace(
    'src/main/imports.ts',
    "instructions: 'Canceled rebuild importer.',",
    "instructions: 'Latest folder importer.',",
  )
  await connectRestartedPage(canceledStarts)
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    'Latest folder importer.',
  )
  mark('clean rebuild restarts after earlier cancellation')

  const metadataStarts = seenEndpoints.length
  await replace(
    'src/addons/ui-preview/hibi-addon.json',
    '"name": "UI preview"',
    '"name": "Updated UI preview"',
  )
  await connectRestartedPage(metadataStarts)
  assert.equal(
    await page.evaluate(async () => {
      const { addons } = await import('/src/addon-registry.ts')
      return addons.find(({ manifest }) => manifest.id === 'ui-preview')
        .manifest.name
    }),
    'Updated UI preview',
  )
  const opened = page.context().waitForEvent('page')
  await page.evaluate(() =>
    window.hibi.openAddonWindow('ui-preview', { id: 'preview' }),
  )
  const owner = await opened
  await owner.waitForFunction(() => Boolean(window.hibiAddonWindow))
  assert.equal(
    (await owner.evaluate(() => window.hibiAddonWindow.context())).title,
    'Updated UI preview',
  )
  await owner.getByRole('button', { name: 'Close', exact: true }).waitFor()
  assert.deepEqual(
    await owner.evaluate(async () => {
      const probe = window.catalogWindowProbe
      return {
        ...probe,
        closed: await probe.closed,
        native: await probe.native,
      }
    }),
    {
      sealed: true,
      desktop: 'undefined',
      closed: true,
      factories: 1,
      starts: 0,
      native: 'owner-native',
    },
  )
  await owner.close()
  mark(
    'json catalog resolves a declared factory entry after sealing the owner bridge',
  )

  const noticeId = 'addon:typst:typst-assets'
  phase('read original notice')
  const originalNotice = await page.evaluate(
    (id) => window.hibi.getLicense(id),
    noticeId,
  )
  const noticeStarts = seenEndpoints.length
  const noticePath = join(root, 'src/addons/typst/hibi-addon.json')
  phase('read notice manifest')
  const noticeManifest = JSON.parse(await readFile(noticePath, 'utf8'))
  assert.equal(noticeManifest.licenses[0].text, originalNotice)
  noticeManifest.licenses[0].text = `Catalog notice probe.\n${originalNotice}`
  phase('write notice manifest')
  await writeFile(noticePath, JSON.stringify(noticeManifest, null, 2))

  await connectRestartedPage(noticeStarts)
  phase('read updated notice')
  assert.equal(
    await page.evaluate((id) => window.hibi.getLicense(id), noticeId),
    `Catalog notice probe.\n${originalNotice}`,
  )
  mark('canonical json notice updates lazy catalog details')

  phase('write documentation generator')
  await replace('scripts/addon-reference.mjs', '[Source]', '[Updated source]')
  await until(
    async () =>
      (
        await readFile(
          join(root, 'docs/development/addon-api-reference/Sidebar.md'),
          'utf8',
        )
      ).includes('[Updated source]'),
    'documentation generator reloads',
  )
  mark('documentation generator updated')
  refreshDiagnostic()
  completed = true
  if (!t.signal.aborted) t.diagnostic(cachedDiagnostic)
})
