import assert from 'node:assert/strict'
import test from 'node:test'
import { codeSpanRanges, openCodeSpanAt } from '../src/shared/prose-context.ts'

test('code spans pair backtick runs of equal length', () => {
  assert.deepEqual(codeSpanRanges('`a` and ``b`c`` d'), [
    [0, 3],
    [8, 15],
  ])
  // An opener with no closer is literal; a later pair still forms a span.
  assert.deepEqual(codeSpanRanges('`a ``b`` c'), [[3, 8]])
  // A backslash escapes an opening backtick, but not a closing one.
  assert.deepEqual(codeSpanRanges('\\`a` b'), [])
  assert.deepEqual(codeSpanRanges('\\``a` b'), [[2, 5]])
  assert.deepEqual(codeSpanRanges('\\``a`` b'), [])
  assert.deepEqual(codeSpanRanges('`a\\` b'), [[0, 4]])
  assert.deepEqual(codeSpanRanges('\\\\`a` b'), [[2, 5]])
})

test('an unclosed backtick run before the offset is open code', () => {
  for (const [text, open] of [
    ['run `npm ins', true],
    ['`code` and hap', false],
    ['``a`b`` and hap', false],
    ['``a`b and hap', true],
    ['use \\` for hap', false],
    ['use \\`` code', true],
    ['`a\\` and hap', false],
  ])
    assert.equal(openCodeSpanAt(text, text.length), open, text)
  assert.equal(openCodeSpanAt('`code` and hap', 3), true)
  assert.equal(openCodeSpanAt('`code` and hap', 6), false)
})
