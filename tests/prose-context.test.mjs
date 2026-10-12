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

test('code spans match CommonMark code span examples on one line', () => {
  // [example, text, closed spans]; an unmatched run is reported as open code.
  const examples = [
    [328, '`foo`', ['`foo`']],
    [329, '`` foo ` bar ``', ['`` foo ` bar ``']],
    [330, '` `` `', ['` `` `']],
    [338, '`foo\\`bar`', ['`foo\\`']],
    [339, '``foo`bar``', ['``foo`bar``']],
    [340, '` foo `` bar `', ['` foo `` bar `']],
    [341, '*foo`*`', ['`*`']],
    [342, '[not a `link](/foo`)', ['`link](/foo`']],
    [343, '`<a href="`">`', ['`<a href="`']],
    [345, '`<https://foo.bar.`baz>`', ['`<https://foo.bar.`']],
    [347, '```foo``', []],
    [348, '`foo', []],
  ]
  for (const [example, text, closed] of examples)
    assert.deepEqual(
      codeSpans(text)
        .filter((span) => span.closed)
        .map(({ from, to }) => text.slice(from, to)),
      closed,
      `example ${example}`,
    )
  // Known differences: raw HTML and autolinks do not take precedence (344,
  // 346), and an unmatched run hides a later pair (349).
  assert.deepEqual(spans('<a href="`">`'), [[9, 13, true]])
  assert.deepEqual(spans('<https://foo.bar.`baz>`'), [[17, 23, true]])
  assert.deepEqual(spans('`foo``bar``'), [[0, 11, false]])
})
