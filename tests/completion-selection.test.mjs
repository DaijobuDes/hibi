import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completionForKey,
  initialCompletionSelection,
} from '../src/renderer/src/completion-selection.ts'

const item = (overrides = {}) => ({
  label: 'word',
  insertText: 'word',
  from: 0,
  to: 0,
  ...overrides,
})

test('next-word predictions leave Enter to newline even after highlighting', () => {
  const items = [item({ preselect: false, acceptOnEnter: false })]
  assert.equal(initialCompletionSelection(items), -1)
  for (const selected of [-1, 0]) {
    assert.equal(completionForKey(items, selected, 'Enter'), null)
    assert.equal(completionForKey(items, selected, 'Tab'), items[0])
  }
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
