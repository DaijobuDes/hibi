import assert from 'node:assert/strict'
import test from 'node:test'
import { codeSpans } from '../src/shared/prose-context.ts'

const spans = (text) =>
  codeSpans(text).map(({ from, to, closed }) => [from, to, closed])

test('code spans close only on a backtick run of equal length', () => {
  assert.deepEqual(spans('`a` b'), [[0, 3, true]])
  assert.deepEqual(spans('``a`b`` c'), [[0, 7, true]])
  assert.deepEqual(spans('```a``b``` c'), [[0, 10, true]])
  assert.deepEqual(spans('`a` and ``b`c`` d'), [
    [0, 3, true],
    [8, 15, true],
  ])
  // A 2-run is not closed by part of a 3-run.
  assert.deepEqual(spans('``a``` b'), [[0, 8, false]])
  assert.deepEqual(spans('``a``` b `` c'), [[0, 11, true]])
  assert.deepEqual(spans('no code'), [])
})

test('backslashes escape openers outside code but not closers inside it', () => {
  assert.deepEqual(spans('use \\` for b'), [])
  assert.deepEqual(spans('\\``a` b'), [[2, 5, true]])
  assert.deepEqual(spans('\\``a`` b'), [[2, 8, false]])
  assert.deepEqual(spans('\\\\`a` b'), [[2, 5, true]])
  assert.deepEqual(spans('`a\\` b'), [[0, 4, true]])
})

test('an unclosed run is open code to the end of the text', () => {
  assert.deepEqual(spans('run `npm ins'), [[4, 12, false]])
  assert.deepEqual(spans('`a` then ``b'), [
    [0, 3, true],
    [9, 12, false],
  ])
  // Later pairs fall inside the open span.
  assert.deepEqual(spans('`a ``b`` c'), [[0, 10, false]])
})
