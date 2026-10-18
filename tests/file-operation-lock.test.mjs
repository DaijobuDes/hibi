import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'

async function setup(t) {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-file-lock-'))
  await writeFile(join(profile, 'addons.json'), '{"quick-note":true}')
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  const child = app.process()
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      await app.evaluate(() => globalThis.fileLockTest?.release?.())
      await app.close()
    }
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await waitForDocumentEditor(app, page)
  const opened = app.waitForEvent('window')
  await page.evaluate(() =>
    window.hibi.openAddonWindow('quick-note', { id: 'capture', show: false }),
  )
  const capture = await opened
  await capture.locator('.tiptap[contenteditable="true"]').waitFor()
  await app.evaluate(({ BrowserWindow, ipcMain, dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    const windows = BrowserWindow.getAllWindows()
    const addon = windows.find((window) =>
      window.webContents.getURL().endsWith('/addon-window.html'),
    )
    const main = windows.find((window) => window !== addon)
    globalThis.fileLockTest = {
      results: {},
      pending: {},
      start(key, channel, fromAddon, ...args) {
        const sender = (fromAddon ? addon : main).webContents
        this.pending[key] = Promise.resolve()
          .then(() =>
            ipcMain._invokeHandlers.get(channel)(
              { sender, senderFrame: sender.mainFrame },
              ...args,
            ),
          )
          .then(
            (value) => {
              this.results[key] = { value }
            },
            (error) => {
              this.results[key] = { error: error.message }
            },
          )
      },
    }
  })
  return { app, profile }
}

test('core mutations and draft writes wait for a held quick-note draft read', {
  timeout: 30000,
}, async (t) => {
  const { app, profile } = await setup(t)
  await writeFile(
    join(profile, 'quick-note-draft.json'),
    JSON.stringify({ markdown: 'earlier', destination: null }),
  )
  await app.evaluate(async () => {
    const state = globalThis.fileLockTest
    const fs = process.getBuiltinModule('node:fs/promises')
    const read = fs.readFile
    const held = Promise.withResolvers()
    const entered = Promise.withResolvers()
    state.release = held.resolve
    fs.readFile = async (...args) => {
      if (String(args[0]).endsWith('quick-note-draft.json')) {
        fs.readFile = read
        process.getBuiltinModule('node:module').syncBuiltinESMExports()
        entered.resolve()
        await held.promise
      }
      return read(...args)
    }
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
    state.start('read', 'addon-windows:invoke', true, 'openDraft')
    await entered.promise
    state.start(
      'choose',
      'addons:invoke',
      false,
      'quick-note',
      'chooseWorkspace',
    )
    state.start('new', 'document:new', false)
    state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'newer',
      destination: null,
    })
    await new Promise(setImmediate)
  })
  assert.deepEqual(
    await app.evaluate(() => globalThis.fileLockTest.results),
    {},
    'overlapping requests must wait without refusing or running early',
  )
  const results = await app.evaluate(async () => {
    const state = globalThis.fileLockTest
    state.release()
    await Promise.all(Object.values(state.pending))
    return state.results
  })
  assert.equal(results.read.value.draft.markdown, 'earlier')
  assert.ok(results.new.value)
  assert.deepEqual(results.choose, { value: null })
  assert.deepEqual(results.write, { value: { keptAs: null } })
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'newer',
  )
})

test('a resolved Open dialog followed by failed file I/O releases a queued draft write', {
  timeout: 30000,
}, async (t) => {
  const { app, profile } = await setup(t)
  const path = join(profile, 'file-lock-source.md')
  await writeFile(path, '# source')
  await app.evaluate(async ({ dialog }, path) => {
    const state = globalThis.fileLockTest
    const held = Promise.withResolvers()
    const entered = Promise.withResolvers()
    state.release = () => held.reject(new Error('held read failure'))
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    const fs = process.getBuiltinModule('node:fs/promises')
    const read = fs.realpath
    fs.realpath = async (...args) => {
      if (String(args[0]).endsWith('file-lock-source.md')) {
        fs.realpath = read
        process.getBuiltinModule('node:module').syncBuiltinESMExports()
        entered.resolve()
        await held.promise
      }
      return read(...args)
    }
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
    state.start('open', 'document:open', false)
    await entered.promise
    state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'kept after failure',
      destination: null,
    })
    await new Promise(setImmediate)
  }, path)
  assert.deepEqual(
    await app.evaluate(() => globalThis.fileLockTest.results),
    {},
  )
  const results = await app.evaluate(async () => {
    const state = globalThis.fileLockTest
    state.release()
    await Promise.all(Object.values(state.pending))
    return state.results
  })
  assert.match(results.open.error, /held read failure/)
  assert.deepEqual(results.write, { value: { keptAs: null } })
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'kept after failure',
  )
})

test('closing drains admitted draft writes and refuses queued main actions and new admissions', {
  timeout: 30000,
}, async (t) => {
  const { app, profile } = await setup(t)
  await app.evaluate(async ({ BrowserWindow, dialog, ipcMain }) => {
    const state = globalThis.fileLockTest
    const main = BrowserWindow.getAllWindows().find(
      (window) => !window.webContents.getURL().endsWith('/addon-window.html'),
    )
    const first = Promise.withResolvers()
    const entered = Promise.withResolvers()
    const write = Promise.withResolvers()
    const writing = Promise.withResolvers()
    const flushed = Promise.withResolvers()
    state.allowedClose = false
    state.openCalls = 0
    const observeClose = (event) => {
      if (!event.defaultPrevented) {
        state.allowedClose = true
        event.preventDefault()
      }
    }
    main.on('close', observeClose)
    ipcMain.on('document:flushed', (_event, token) => {
      if (token !== 'ready') flushed.resolve()
    })
    state.release = () => {
      first.resolve()
      write.resolve()
      main.off('close', observeClose)
    }
    state.finish = async () => {
      write.resolve()
      await Promise.all(Object.values(state.pending))
      await new Promise(setImmediate)
      main.off('close', observeClose)
      return { results: state.results, openCalls: state.openCalls }
    }
    dialog.showOpenDialog = async () => {
      state.openCalls++
      return { canceled: true, filePaths: [] }
    }
    const fs = process.getBuiltinModule('node:fs/promises')
    const read = fs.readFile
    const writeFile = fs.writeFile
    fs.readFile = async (...args) => {
      if (String(args[0]).endsWith('quick-note-draft.json')) {
        fs.readFile = read
        process.getBuiltinModule('node:module').syncBuiltinESMExports()
        entered.resolve()
        await first.promise
      }
      return read(...args)
    }
    fs.writeFile = async (...args) => {
      if (String(args[0]).endsWith('quick-note-draft.json.tmp')) {
        fs.writeFile = writeFile
        process.getBuiltinModule('node:module').syncBuiltinESMExports()
        writing.resolve()
        await write.promise
      }
      return writeFile(...args)
    }
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
    state.start('read', 'addon-windows:invoke', true, 'openDraft')
    await entered.promise
    state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'kept before closing',
      destination: null,
    })
    state.start('open', 'document:open', false)
    await new Promise(setImmediate)
    main.close()
    await flushed.promise
    state.start('lateWrite', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'too late',
      destination: null,
    })
    await new Promise(setImmediate)
    first.resolve()
    await writing.promise
    await new Promise(setImmediate)
  })
  let result
  try {
    assert.equal(
      await app.evaluate(() => globalThis.fileLockTest.allowedClose),
      false,
    )
    assert.match(
      await app.evaluate(
        () => globalThis.fileLockTest.results.lateWrite?.error ?? '',
      ),
      /Another file operation is in progress/,
    )
  } finally {
    result = await app.evaluate(() => globalThis.fileLockTest.finish())
  }
  assert.equal(result.openCalls, 0)
  assert.match(
    result.results.open.error,
    /Another file operation is in progress/,
  )
  assert.deepEqual(result.results.write, { value: { keptAs: null } })
  await app.close()
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'kept before closing',
  )
})

test('held Open and quick-note folder dialogs refuse overlapping draft writes', {
  timeout: 30000,
}, async (t) => {
  const { app } = await setup(t)
  for (const fromAddon of [false, true]) {
    await app.evaluate(async ({ dialog }, fromAddon) => {
      const state = globalThis.fileLockTest
      state.results = {}
      state.pending = {}
      const held = Promise.withResolvers()
      const entered = Promise.withResolvers()
      state.release = held.resolve
      dialog.showOpenDialog = async () => {
        entered.resolve()
        await held.promise
        return { canceled: true, filePaths: [] }
      }
      if (fromAddon)
        state.start('dialog', 'addon-windows:invoke', true, 'chooseWorkspace')
      else state.start('dialog', 'document:open', false)
      await entered.promise
      state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
        markdown: 'waiting for user',
        destination: null,
      })
      await new Promise(setImmediate)
    }, fromAddon)
    try {
      assert.match(
        await app.evaluate(
          () => globalThis.fileLockTest.results.write?.error ?? '',
        ),
        /Another file operation is in progress/,
      )
    } finally {
      await app.evaluate(async () => {
        const state = globalThis.fileLockTest
        state.release()
        await Promise.all(Object.values(state.pending))
      })
    }
  }
})
