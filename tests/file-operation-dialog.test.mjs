import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
