import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
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
import { showTestWindows, startupDiagnostics } from './electron.mjs'
import { waitForAsync } from './poll.mjs'

test('development watches main, renderer, preload, addons, and documentation generation', {
  timeout: 180000,
}, async (t) => {
  const started = performance.now()
  let output = '',
    cachedDiagnostic = '',
    omitted = 0,
    completed = false
  const timeline = []
  function byteHead(text, limit) {
    const bytes = Buffer.from(text)
    let end = Math.min(bytes.length, limit)
    while ((bytes[end] & 0xc0) === 0x80) end--
    return bytes.toString('utf8', 0, end)
  }
  function refreshDiagnostic() {
    cachedDiagnostic = `cached snapshot (elapsed ms, not abort time): at=${Math.round(performance.now() - started)}; omitted=${omitted}\n${timeline.join('\n')}\nchild tail:\n${byteHead(output.slice(-2048), 2048)}`
  }
  function phase(label) {
    if (timeline.length === 96) {
      timeline.splice(24, 1)
      omitted++
    }
    timeline.push(
      byteHead(`${Math.round(performance.now() - started)} ${label}`, 128),
    )
    refreshDiagnostic()
  }
  const mark = (message) => {
    phase(message)
    t.diagnostic(`${message} (${Math.round(performance.now() - started)} ms)`)
  }
  phase('copy fixture')
  t.signal.addEventListener(
    'abort',
    () => {
      if (!completed) {
        try {
          console.error(cachedDiagnostic)
        } catch {}
      }
    },
    { once: true },
  )
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
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction')
  const localFolder = join(root, 'src/useraddons/dev-watch-local')
  await mkdir(localFolder, { recursive: true })
  for (const [name, content] of Object.entries({
    'hibi-addon.json': JSON.stringify({
      id: 'dev-watch-local',
      capabilities: [],
      name: 'Local watch fixture',
      description: 'Local targeted update probe',
      apiVersion: 2,
      kind: 'extension',
      version: '1.0.0',
      authors: [{ displayName: 'Test' }],
      startup: 'background',
      defaultEnabled: true,
      entry: 'index.ts',
      styles: ['declared.css'],
      themes: ['theme.json'],
    }),
    'README.md': '# Local watch fixture',
    'theme.json': JSON.stringify({
      id: 'watch',
      name: 'Watch theme',
      appearance: 'dark',
      author: 'Test',
      license: { name: 'MIT', text: 'Permission notice' },
      colors: {
        background: '#101820',
        surface: '#202830',
        ink: '#eeeeee',
        muted: '#aaaaaa',
        accent: '#88cccc',
        border: '#333333',
      },
    }),
    'helper.ts': "export const label = 'local original'",
    'inline.css': 'body { --local-inline: original; }',
    'declared.css': 'body { --local-declared: original; }',
    'index.ts': `
      import { label } from './helper'
      import css from './inline.css?inline'
      export default () => ({
        start(context) {
          const probe = window.localWatchProbe ??= { starts: 0, stops: 0, state: 41 }
          probe.starts++
          window.useLocalWatchTheme = () => context.colorschemes.setPreferences({
            mode: 'dark', dark: 'dev-watch-local.watch',
          })
          context.styles.register('inline', css)
          context.statusBar.register({ id: 'probe', label })
        },
        stop() { window.localWatchProbe.stops++ },
      })
    `,
  }))
    await writeFile(join(localFolder, name), content)
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
      const lifecycle = owner ? undefined : (window.previewWatchProbe ??= {
        starts: 0, stops: 0, state: 73,
      })
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
            if (lifecycle) lifecycle.starts++
            return original.start(context)
          },
          stop() {
            if (lifecycle) lifecycle.stops++
            original.stop?.()
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
    'const [result] = await licenseBuild',
    'analysisBundles(),',
    'plugins: [sandboxPreloads()],',
  ])
    assert.equal(
      configSource.split(marker).length,
      2,
      `config probe anchor: ${marker}`,
    )
  const config = (
    "let watchedBuild = 0, watchedStart = 0, watchedLines = 0\nfunction buildMark(kind: string, build: number, elapsed = 0) {\n  if (++watchedLines > 32) return\n  try { console.log('[dev-watch]', ...(watchedLines === 32 ? ['clipped'] : [kind, build, Math.round(elapsed)])) } catch {}\n}\nfunction watchedLicenses() {\n  const build = ++watchedBuild, start = performance.now()\n  watchedStart = start\n  buildMark('main-start', build)\n  buildMark('licenses-start', build)\n  const work = writeLicenses()\n  const done = () => buildMark('licenses-end', build, performance.now() - start)\n  work.then(done, done)\n  return work\n}\n" +
    configSource
  )
    .replace(
      'licenseBuild = Promise.allSettled([writeLicenses()])',
      'licenseBuild = Promise.allSettled([watchedLicenses()])',
    )
    .replace(
      'const [result] = await licenseBuild',
      "buildMark('graphEnd', watchedBuild, performance.now() - watchedStart)\n            const [result] = await licenseBuild",
    )
    .replace(
      'analysisBundles(),',
      `analysisBundles(),
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
    JSON.stringify({
      'typing-speed': true,
      'ui-preview': true,
    }),
  )
  const seenEndpoints = []
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
  const collect = (data, stream) => {
    const chunk = data.toString()
    output = (output + chunk).slice(-256000)
    const lines = (pendingLines[stream] + chunk).split(/\r?\n/)
    pendingLines[stream] = lines.pop()
    for (const line of lines) {
      const endpoint = line.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]
      if (endpoint && !seenEndpoints.includes(endpoint))
        seenEndpoints.push(endpoint)
      if (
        /^\[dev-watch\] (?:(main-start|licenses-start|licenses-end|graphEnd) \d+ \d+|clipped)$/.test(
          line,
        )
      ) {
        phase(line)
        if (!completed && !t.signal.aborted) {
          try {
            t.diagnostic(line)
          } catch {}
        }
      }
    }
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
  phase('connect first devtools')
  browser = await chromium.connectOverCDP(seenEndpoints[0])
  let page = browser.contexts()[0].pages()[0]
  page.setDefaultTimeout(30000)
  phase('initial renderer readiness')
  try {
    await page.locator('[data-status-id="typing-speed.wpm"]').waitFor()
  } catch (error) {
    try {
      console.error(
        'initial renderer startup:',
        JSON.stringify(await startupDiagnostics(undefined, page)),
      )
    } catch {}
    throw error
  }
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
  async function addonUpdate(id, scope, edit, status = 'reloaded') {
    const messages = []
    const collect = (message) => messages.push(message.text().slice(0, 500))
    page.on('console', collect)
    try {
      await Promise.all([
        page.waitForEvent('console', {
          timeout: status === 'idle' ? 7000 : undefined,
          predicate: (message) =>
            message.type() === 'info' &&
            message.text() === `addon ${id}: ${scope} ${status}`,
        }),
        edit(),
      ])
    } catch (error) {
      assert.fail(
        `${error.message}\n${messages.slice(-8).join('\n')}\n${output.slice(-1800)}`,
      )
    } finally {
      page.off('console', collect)
    }
  }
  const addonFailure = (edit) =>
    Promise.all([
      page.waitForEvent('console', {
        predicate: (message) =>
          message.type() === 'error' &&
          message
            .text()
            .includes('addon update failed; keeping the running addon'),
      }),
      edit(),
    ])
  async function captureAddonState() {
    await page.waitForFunction(
      () => window.previewWatchProbe?.starts && window.localWatchProbe?.starts,
    )
    await page.evaluate(() => {
      window.watchSentinel?.remove()
      window.watchSentinel = document.createElement('span')
      window.watchSentinel.id = 'dev-watch-sentinel'
      document.body.append(window.watchSentinel)
    })
    return addonState()
  }
  async function addonState() {
    return {
      endpoints: seenEndpoints.length,
      ...(await page.evaluate(async () => {
        const draft = await window.hibi.getDocument()
        return {
          epoch: performance.timeOrigin,
          sentinel:
            Boolean(window.watchSentinel?.isConnected) &&
            document.getElementById('dev-watch-sentinel') ===
              window.watchSentinel,
          preview: { ...window.previewWatchProbe },
          local: { ...window.localWatchProbe },
          markdown: draft.markdown,
          dirty: draft.dirty,
        }
      })),
    }
  }
  const beforeAddons = await captureAddonState()
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector('style[data-addon-style="ui-preview.preview"]'),
    ),
  )
  await page.evaluate(() => {
    window.previewStyle = document.querySelector(
      'style[data-addon-style="ui-preview.preview"]',
    )
    window.localWatchProbe.state = 42
    window.previewWatchProbe.state = 74
  })
  beforeAddons.local.state = 42
  beforeAddons.preview.state = 74
  const previewCss = join(previewFolder, 'style.css')
  await addonUpdate('ui-preview', 'styles', async () =>
    writeFile(
      previewCss,
      `${await readFile(previewCss, 'utf8')}\nbody { --preview-watch: updated; }\n`,
    ),
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(document.body)
        .getPropertyValue('--preview-watch')
        .trim() === 'updated',
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.previewStyle ===
        document.querySelector('style[data-addon-style="ui-preview.preview"]'),
    ),
    true,
  )
  assert.deepEqual(await addonState(), beforeAddons)
  for (const [file, property] of [
    ['inline.css', '--local-inline'],
    ['declared.css', '--local-declared'],
  ]) {
    await page.waitForFunction(
      (property) =>
        getComputedStyle(document.body).getPropertyValue(property).trim() ===
        'original',
      property,
    )
    await addonUpdate('dev-watch-local', 'styles', () =>
      replace(`src/useraddons/dev-watch-local/${file}`, 'original', 'updated'),
    )
    await page.waitForFunction(
      (property) =>
        getComputedStyle(document.body).getPropertyValue(property).trim() ===
        'updated',
      property,
    )
    assert.deepEqual(await addonState(), beforeAddons)
  }
  await page.evaluate(() => window.useLocalWatchTheme())
  await page.waitForFunction(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim() === '#88cccc',
  )
  await addonUpdate('dev-watch-local', 'styles', () =>
    replace('src/useraddons/dev-watch-local/theme.json', '#88cccc', '#ff00ff'),
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim() === '#ff00ff',
  )
  assert.deepEqual(await addonState(), beforeAddons)
  mark(
    'inline css, declared sheets, and theme json update without addon restarts',
  )

  await addonUpdate('typing-speed', 'code', () =>
    replace(
      'src/addons/typing-speed/index.ts',
      'This estimates how many words you type per minute.',
      'Updated typing speed runtime.',
    ),
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
  assert.deepEqual(await addonState(), beforeAddons)
  await addonUpdate('dev-watch-local', 'code', () =>
    replace(
      'src/useraddons/dev-watch-local/helper.ts',
      'local original',
      'local updated',
    ),
  )
  assert.equal(
    await page
      .locator('[data-status-id="dev-watch-local.probe"]')
      .textContent(),
    'Local updated',
    JSON.stringify(await addonState()),
  )
  const afterHelper = {
    ...beforeAddons,
    local: {
      ...beforeAddons.local,
      starts: beforeAddons.local.starts + 1,
      stops: beforeAddons.local.stops + 1,
    },
  }
  assert.deepEqual(await addonState(), afterHelper)
  const helper = join(localFolder, 'helper.ts')
  const workingHelper = await readFile(helper, 'utf8')
  await addonUpdate('ui-preview', 'styles', () =>
    addonFailure(() =>
      Promise.all([
        writeFile(helper, 'export const label = ;'),
        replace(
          'src/addons/ui-preview/style.css',
          '--preview-watch: updated',
          '--preview-watch: coalesced',
        ),
      ]),
    ),
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(document.body)
        .getPropertyValue('--preview-watch')
        .trim() === 'coalesced',
  )
  assert.deepEqual(await addonState(), afterHelper)
  await page.getByText(/^local updated$/i).waitFor()
  await addonUpdate('dev-watch-local', 'code', () =>
    writeFile(
      helper,
      workingHelper.replace('local updated', 'local recovered'),
    ),
  )
  await page.getByText(/^local recovered$/i).waitFor()
  assert.deepEqual(await addonState(), {
    ...afterHelper,
    local: {
      ...afterHelper.local,
      starts: afterHelper.local.starts + 1,
      stops: afterHelper.local.stops + 1,
    },
  })
  const afterRecovery = await addonState()
  await addonFailure(() =>
    writeFile(helper, "export const renamed = 'missing label'"),
  )
  assert.deepEqual(await addonState(), afterRecovery)
  await page.getByText(/^local recovered$/i).waitFor()
  await addonUpdate('dev-watch-local', 'code', () =>
    writeFile(helper, workingHelper.replace('local updated', 'local linked')),
  )
  await page.getByText(/^local linked$/i).waitFor()
  const afterLink = {
    ...afterRecovery,
    local: {
      ...afterRecovery.local,
      starts: afterRecovery.local.starts + 1,
      stops: afterRecovery.local.stops + 1,
    },
  }
  assert.deepEqual(await addonState(), afterLink)

  const localManifest = join(localFolder, 'hibi-addon.json')
  const localMetadata = JSON.parse(await readFile(localManifest, 'utf8'))
  for (const enabled of [false, true]) {
    localMetadata.defaultEnabled = enabled
    await addonUpdate(
      'dev-watch-local',
      'code',
      () => writeFile(localManifest, JSON.stringify(localMetadata)),
      'idle',
    )
    await waitForAsync(
      page,
      async (enabled) => {
        const state = (await window.hibi.getAddonStates()).find(
          (entry) => entry.id === 'dev-watch-local',
        )
        return state.enabled === enabled && state.savedEnabled === undefined
      },
      enabled,
    )
    assert.equal(
      await page.evaluate(async () => {
        const { addons } = await import('/src/addon-registry.ts')
        return addons.find(({ manifest }) => manifest.id === 'dev-watch-local')
          .manifest.defaultEnabled
      }),
      enabled,
    )
    await page.locator('[data-status-id="dev-watch-local.probe"]').waitFor({
      state: enabled ? 'visible' : 'detached',
    })
    assert.deepEqual(await addonState(), {
      ...afterLink,
      local: {
        ...afterLink.local,
        starts: afterLink.local.starts + Number(enabled),
        stops: afterLink.local.stops + 1,
      },
    })
  }
  assert.equal(
    Object.hasOwn(
      JSON.parse(await readFile(join(profile, 'addons.json'), 'utf8')),
      'dev-watch-local',
    ),
    false,
  )
  mark(
    'link failures keep running addon; manifest defaults toggle without saved override',
  )
  for (const metadata of [
    { network: { origins: ['https://example.com'] } },
    { requires: { addons: [{ id: 'typing-speed' }] } },
  ]) {
    const beforePermissions = await addonState()
    const request = {
      owner: 'dev-watch-local',
      scope: { kind: 'session' },
      key: 'watch-permissions',
      version: 1,
    }
    assert.equal(
      (
        await page.evaluate(
          (request) =>
            window.hibi.writeAddonStorage({
              ...request,
              value: 'old activation',
              baseRevision: 0,
            }),
          request,
        )
      ).status,
      'saved',
    )
    Object.assign(localMetadata, metadata)
    await addonUpdate('dev-watch-local', 'code', () =>
      writeFile(localManifest, JSON.stringify(localMetadata)),
    )
    assert.deepEqual(
      await page.evaluate(
        (request) => window.hibi.readAddonStorage(request),
        request,
      ),
      { status: 'missing', revision: 0 },
    )
    assert.deepEqual(await addonState(), {
      ...beforePermissions,
      local: {
        ...beforePermissions.local,
        starts: beforePermissions.local.starts + 1,
        stops: beforePermissions.local.stops + 1,
      },
    })
  }
  mark('permission and requirement edits retire old main activation resources')
  assert.equal(
    viteConnections,
    0,
    `addon updates keep the Vite socket: ${viteEvents}`,
  )
  mark('local helper compile failure keeps old addon; recovery preserves draft')
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
    // Send an editor keystroke: fill('') can skip deletion after a dev reload.
    await editor.press('ControlOrMeta+A')
    await editor.press('Backspace')
    const afterInput = await inspect()
    await page.evaluate(() => window.hibi.flushDocumentChanges())
    const afterFlush = await inspect()
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
    'src/addons/ui-preview/host.ts',
    "'owner-native'",
    "'owner-native-canceled'",
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
  assert.deepEqual(
    await page.evaluate(async () => {
      const draft = await window.hibi.getDocument()
      return {
        markdown: draft.markdown,
        dirty: draft.dirty,
        dirtyTab: draft.tabs.some((tab) => tab.dirty),
      }
    }),
    { markdown: 'draft protected from restart', dirty: true, dirtyTab: true },
  )
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    'Updated folder importer.',
  )
  mark('native addon restart cancellation keeps running app and dirty draft')

  await clearDraft('draft protected from restart')
  await replace(
    'src/addons/ui-preview/host.ts',
    "'owner-native-canceled'",
    "'owner-native-updated'",
  )
  await connectRestartedPage(canceledStarts)
  assert.equal(
    (await page.evaluate(() => window.hibi.listImporters())).find(
      (importer) => importer.id === 'folder',
    ).instructions,
    'Updated folder importer.',
  )
  mark('native addon clean rebuild restarts after earlier cancellation')

  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .fill('draft protected from contract restart')
  await waitForAsync(page, async () => {
    const document = await window.hibi.getDocument()
    return (
      document.markdown === 'draft protected from contract restart' &&
      document.dirty
    )
  })
  const beforeContract = await captureAddonState()
  const contractStarts = seenEndpoints.length
  const canceledRestarts = output.split(
    'electron restart canceled; keeping current app',
  ).length
  await rm(closePromptCanceled)
  await writeFile(cancelNextClose, '')
  await writeFile(
    join(previewFolder, 'host-next.ts'),
    (await readFile(join(previewFolder, 'host.ts'), 'utf8')).replace(
      'owner-native-updated',
      'owner-native-contract',
    ),
  )
  await replace(
    'src/addons/ui-preview/hibi-addon.json',
    '"entry": "host.ts"',
    '"entry": "host-next.ts"',
  )
  await until(
    () =>
      output.split('electron restart canceled; keeping current app').length >
      canceledRestarts,
    'native contract restart is canceled',
    60000,
  )
  await Promise.all([
    page.waitForEvent('console', {
      predicate: (message) =>
        message.type() === 'warning' &&
        message
          .text()
          .includes('Native or analysis changes are waiting for restart'),
    }),
    (async () => {
      const manifest = JSON.parse(await readFile(previewManifest, 'utf8'))
      manifest.description = 'Pending native contract'
      await writeFile(previewManifest, JSON.stringify(manifest, null, 2))
    })(),
  ])
  assert.deepEqual(await addonState(), beforeContract)
  await clearDraft('draft protected from contract restart')
  await replace(
    'src/addons/ui-preview/host-next.ts',
    'export default',
    '\nexport default',
  )
  await connectRestartedPage(contractStarts)
  mark('native contract stays pending after cancellation until guarded restart')

  const beforeMetadata = await captureAddonState()
  await addonUpdate('ui-preview', 'code', () =>
    replace(
      'src/addons/ui-preview/hibi-addon.json',
      '"name": "UI preview"',
      '"name": "Updated UI preview"',
    ),
  )
  assert.deepEqual(await addonState(), {
    ...beforeMetadata,
    preview: {
      ...beforeMetadata.preview,
      starts: beforeMetadata.preview.starts + 1,
      stops: beforeMetadata.preview.stops + 1,
    },
  })
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
      native: 'owner-native-contract',
    },
  )
  const beforeRefusal = await captureAddonState()
  const ownerEpoch = await owner.evaluate(() => performance.timeOrigin)
  await Promise.all([
    page.waitForEvent('console', {
      predicate: (message) =>
        message.type() === 'warning' &&
        /addon ui-preview: Close the Updated UI preview windows before reloading Updated UI preview/i.test(
          message.text(),
        ),
    }),
    replace(
      'src/addons/ui-preview/window.tsx',
      'if (probe) probe.factories++',
      'if (probe) probe.factories += 2',
    ),
  ])
  assert.deepEqual(await addonState(), beforeRefusal)
  assert.equal(await owner.evaluate(() => performance.timeOrigin), ownerEpoch)
  assert.equal(
    await owner.evaluate(() => window.catalogWindowProbe.factories),
    1,
  )
  await owner.getByRole('button', { name: 'Close', exact: true }).waitFor()
  await owner.close()
  await addonUpdate('ui-preview', 'code', () =>
    replace(
      'src/addons/ui-preview/window.tsx',
      'if (probe) probe.factories += 2',
      'if (probe) probe.factories++',
    ),
  )
  mark('metadata updates main owner title; open owner refuses code replacement')

  const noticeId = 'addon:typst:typst-assets'
  phase('read original notice')
  const originalNotice = await page.evaluate(
    (id) => window.hibi.getLicense(id),
    noticeId,
  )
  const beforeNotice = await captureAddonState()
  const noticePath = join(root, 'src/addons/typst/hibi-addon.json')
  const noticeManifest = JSON.parse(await readFile(noticePath, 'utf8'))
  assert.equal(noticeManifest.licenses[0].text, originalNotice)
  noticeManifest.licenses[0].text = `Catalog notice probe.\n${originalNotice}`
  await addonUpdate(
    'typst',
    'code',
    () => writeFile(noticePath, JSON.stringify(noticeManifest, null, 2)),
    'idle',
  )
  assert.deepEqual(await addonState(), beforeNotice)
  assert.equal(
    await page.evaluate((id) => window.hibi.getLicense(id), noticeId),
    `Catalog notice probe.\n${originalNotice}`,
  )
  mark('canonical json notice updates lazy catalog details')

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
})

test('production output omits the addon development bridge and watcher', async () => {
  await assert.rejects(access(resolve('out/.addon-restart')), {
    code: 'ENOENT',
  })
  let checked = 0
  for (const directory of ['out/main', 'out/preload', 'out/renderer']) {
    for (const file of await readdir(resolve(directory), { recursive: true })) {
      if (!/\.m?js$/.test(file)) continue
      const code = await readFile(resolve(directory, file), 'utf8')
      assert.doesNotMatch(
        code,
        /addons:development-manifest|updateDevelopmentAddon|developmentContract|hibi:addon-update|watchAddonDevelopment|addon-development/,
        `${directory}/${file} contains addon development code`,
      )
      checked++
    }
  }
  assert.ok(checked > 0, 'production JavaScript was checked')
})
