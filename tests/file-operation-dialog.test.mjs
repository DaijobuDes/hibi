import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fileOperationDialogOpened,
  fileOperationHasDialog,
  runFileDialog,
  withinFileOperation,
} from '../src/main/file-operation-dialog.ts'

test('overlapping dialogs stay interactive until both close', async () => {
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  await withinFileOperation(async () => {
    const left = runFileDialog(() => first.promise)
    const right = runFileDialog(() => second.promise)
    assert.equal(fileOperationHasDialog(), true)
    first.resolve()
    await left
    assert.equal(fileOperationHasDialog(), true)
    second.resolve()
    await right
    assert.equal(fileOperationHasDialog(), false)
  })
  assert.equal(fileOperationHasDialog(), false)
})

test('a dialog outside the locked operation cannot mark it interactive', async () => {
  const work = Promise.withResolvers()
  const dialog = Promise.withResolvers()
  const pending = withinFileOperation(() => work.promise)
  const unrelated = runFileDialog(() => dialog.promise)
  assert.equal(fileOperationHasDialog(), false)
  dialog.resolve()
  await unrelated
  work.resolve()
  await pending
})

test('opening a dialog wakes waiters and closing it rearms the signal', async () => {
  await withinFileOperation(async () => {
    const first = fileOperationDialogOpened()
    const held = Promise.withResolvers()
    const pending = runFileDialog(() => held.promise)
    await first
    assert.equal(fileOperationHasDialog(), true)
    held.resolve()
    await pending
    const next = fileOperationDialogOpened()
    assert.notEqual(next, first)
    let opened = false
    void next.then(() => {
      opened = true
    })
    await Promise.resolve()
    assert.equal(opened, false)
    await runFileDialog(async () => {})
    await next
    assert.equal(opened, true)
    assert.equal(fileOperationHasDialog(), false)
  })
})

test('a rejected dialog and synchronous operation failure clear ownership', async () => {
  await assert.rejects(
    withinFileOperation(() =>
      runFileDialog(() => Promise.reject(new Error('dialog failed'))),
    ),
    /dialog failed/,
  )
  assert.equal(fileOperationHasDialog(), false)
  await assert.rejects(
    withinFileOperation(() => {
      throw new Error('operation failed')
    }),
    /operation failed/,
  )
  assert.equal(fileOperationHasDialog(), false)
})
