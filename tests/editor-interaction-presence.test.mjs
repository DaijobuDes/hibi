import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countEditorInteractionProvider,
  hasEditorInteractionProviders,
  onEditorInteractionProvidersChanged,
  setEditorCommandMenu,
} from '../src/renderer/src/editor-interaction-presence.ts'

test('interaction UI activates for first provider and detaches after last', () => {
  const states = []
  const unsubscribe = onEditorInteractionProvidersChanged(() => {
    states.push(hasEditorInteractionProviders())
  })
  const first = countEditorInteractionProvider()
  const second = countEditorInteractionProvider()
  first()
  assert.equal(hasEditorInteractionProviders(), true)
  second()
  second()
  unsubscribe()
  assert.deepEqual(states, [true, false])
  assert.equal(hasEditorInteractionProviders(), false)
})

test('command and provider changes keep present interaction UI attached', () => {
  const states = []
  const unsubscribe = onEditorInteractionProvidersChanged(() => {
    states.push(hasEditorInteractionProviders())
  })
  const capture = () => ({ source: 'menu' })
  const inspect = { id: 'probe.inspect', menu: { location: 'editor' } }
  setEditorCommandMenu([inspect], capture)
  setEditorCommandMenu([inspect, { id: 'late.export' }], capture)
  const provider = countEditorInteractionProvider()
  provider()
  setEditorCommandMenu([], capture)
  unsubscribe()
  assert.deepEqual(states, [true, false])
})
