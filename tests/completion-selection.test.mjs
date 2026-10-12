import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completionForKey,
  dismissCompletionForArrow,
  initialCompletionSelection,
} from '../src/renderer/src/completion-selection.ts'

const item = (overrides = {}) => ({
  label: 'word',
  insertText: 'word',
  from: 0,
  to: 0,
  ...overrides,
})

test('next-word predictions never accept Enter or Tab, even after highlighting', () => {
  const items = [
    item({ preselect: false, acceptOnEnter: false, acceptOnTab: false }),
  ]
  assert.equal(initialCompletionSelection(items), -1)
  for (const selected of [-1, 0]) {
    assert.equal(completionForKey(items, selected, 'Enter'), null)
    assert.equal(completionForKey(items, selected, 'Tab'), null)
  }
})

test('only all-next-word popups release arrows; mixed lists retain navigation', () => {
  const next = item({ captureArrowKeys: false })
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.equal(dismissCompletionForArrow([next], key), true)
    assert.equal(dismissCompletionForArrow([next, next], key), true)
    assert.equal(dismissCompletionForArrow([item(), next], key), false)
    assert.equal(dismissCompletionForArrow([next, item()], key), false)
    assert.equal(dismissCompletionForArrow([item()], key), false)
    assert.equal(
      dismissCompletionForArrow([item({ captureArrowKeys: true })], key),
      false,
    )
    assert.equal(dismissCompletionForArrow([], key), false)
  }
  for (const key of ['Enter', 'Tab', 'Escape', 'a'])
    assert.equal(dismissCompletionForArrow([next], key), false)
})

test('in-word predictions require explicit selection for Enter; Tab accepts first', () => {
  const items = [item({ preselect: false, acceptOnEnter: 'selected' })]
  assert.equal(initialCompletionSelection(items), -1)
  assert.equal(completionForKey(items, -1, 'Enter'), null)
  assert.equal(completionForKey(items, 0, 'Enter'), items[0])
  assert.equal(completionForKey(items, -1, 'Tab'), items[0])
  assert.equal(
    initialCompletionSelection([item({ acceptOnEnter: 'selected' })]),
    -1,
  )
})

test('generic providers retain preselection and Enter acceptance', () => {
  const items = [item(), item({ label: 'other' })]
  assert.equal(initialCompletionSelection(items), 0)
  assert.equal(completionForKey(items, 0, 'Enter'), items[0])
  assert.equal(completionForKey(items, 1, 'Enter'), items[1])
  assert.equal(completionForKey(items, 1, 'Tab'), items[1])
})

test('disabled Tab and empty menus do not consume keys', () => {
  const items = [item({ preselect: false, acceptOnTab: false })]
  for (const selected of [-1, 0])
    assert.equal(completionForKey(items, selected, 'Tab'), null)
  assert.equal(initialCompletionSelection([]), -1)
  assert.equal(completionForKey([], -1, 'Tab'), null)
  assert.equal(completionForKey([], 0, 'Enter'), null)
})
