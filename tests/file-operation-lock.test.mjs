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
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
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
  assert.deepEqual(results.write, { value: { keptAs: null } })
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'newer',
  )
})

test('a failed core operation releases a queued quick-note draft write', {
  timeout: 30000,
}, async (t) => {
  const { app, profile } = await setup(t)
  await app.evaluate(async ({ dialog }) => {
    const state = globalThis.fileLockTest
    const held = Promise.withResolvers()
    const entered = Promise.withResolvers()
    state.release = () => held.reject(new Error('held open failure'))
    dialog.showOpenDialog = () => {
      entered.resolve()
      return held.promise
    }
    state.start('open', 'document:open', false)
    await entered.promise
    state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'kept after failure',
      destination: null,
    })
    await new Promise(setImmediate)
  })
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
  assert.match(results.open.error, /held open failure/)
  assert.deepEqual(results.write, { value: { keptAs: null } })
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'kept after failure',
  )
})

test('closing waits for the queued draft write after the active operation finishes', {
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
    main.on('close', (event) => {
      if (!event.defaultPrevented) state.allowedClose = true
    })
    ipcMain.on('document:flushed', (_event, token) => {
      if (token !== 'ready') flushed.resolve()
    })
    state.release = () => {
      first.resolve()
      write.resolve()
    }
    state.releaseWrite = write.resolve
    dialog.showOpenDialog = async () => {
      entered.resolve()
      await first.promise
      return { canceled: true, filePaths: [] }
    }
    const fs = process.getBuiltinModule('node:fs/promises')
    const writeFile = fs.writeFile
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
    state.start('choose', 'addon-windows:invoke', true, 'chooseWorkspace')
    await entered.promise
    state.start('write', 'addon-windows:invoke', true, 'saveDraft', {
      markdown: 'kept before closing',
      destination: null,
    })
    main.close()
    await flushed.promise
    await new Promise(setImmediate)
    first.resolve()
    await writing.promise
    await new Promise(setImmediate)
  })
  try {
    assert.equal(
      await app.evaluate(() => globalThis.fileLockTest.allowedClose),
      false,
      'closing must keep waiting while the queued draft write is held',
    )
  } finally {
    await app.evaluate(() => globalThis.fileLockTest.releaseWrite())
  }
  await app.close()
  assert.equal(
    JSON.parse(await readFile(join(profile, 'quick-note-draft.json'), 'utf8'))
      .markdown,
    'kept before closing',
  )
})
