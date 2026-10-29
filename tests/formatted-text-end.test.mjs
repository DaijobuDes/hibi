import assert from 'node:assert/strict'
import test from 'node:test'
import { Text } from '@codemirror/state'
import { GFM, parser } from '@lezer/markdown'
import { ChunkedMarkdownParser } from '../src/renderer/src/chunked-markdown.ts'
import { formattedTextEnd } from '../src/renderer/src/formatted-text-end.ts'

const markdown = parser.configure(GFM)
const text = (source) => Text.of(source.split('\n'))

test('a note opens with the caret at the end of its last text block', () => {
  // ‸ marks the caret.
  for (const marked of [
    '',
    'plain\n\nlast‸\n',
    'plain\n\n## Last‸ ##\n',
    'plain\n\nLast‸\n===\n',
    '> quoted\n> last‸\n>\n',
    '- one\n  - two\n    - last‸\n',
    '- one\n-‸\n',
    '```js\ncode\nlast‸\n```\n',
    '- item\n\n  > ```\n  > code\n  > last‸\n  > ```\n',
    '```\ncode\nlast‸\n',
    '    code\n    last‸\n',
    // The view draws no lines for an empty fence.
    '```\n```‸\n',
    '| a | b |\n| - | - |\n| c | d‸ |\n',
    '- item\n\n  > | a | b |\n  > | - | - |\n  > | c | d‸\n',
    '| a | b |\n| - | - |\n| c | d‸ | e |\n',
    '| a | b |\n| - | - |\n| c | ‸|\n',
    '| a | b‸ |\n| - | - |\n',
    // A row with fewer cells than columns ends in its last written cell.
    '| a | b |\n| - | - |\n| c‸ |\n',
    'plain‸\n\n[a]: https://example.test\n',
    // Blank lines after the last block that show an empty paragraph.
    'last‸\n',
    'last\n\n‸',
    'last\n\n‸\n',
    'last\n\n\n\n‸',
    '| a |\n| - |\n| c |\n\n‸\n',
  ]) {
    const source = marked.replace('‸', '')
    assert.equal(
      formattedTextEnd(text(source), markdown.parse(source)),
      marked.includes('‸') ? marked.indexOf('‸') : 0,
      JSON.stringify(marked),
    )
  }
})

test('a fence drawn as a widget, or a tree short of the end, keeps the caret at the source end', () => {
  const fence = 'plain\n\n```mermaid\ngraph TD\n```\n'
  const asked = []
  const drawn = (pos) => asked.push(pos) && false
  assert.equal(
    formattedTextEnd(text(fence), markdown.parse(fence), drawn),
    fence.length - 1,
  )
  assert.deepEqual(asked, [fence.indexOf('graph TD') + 'graph TD'.length])
  // The open caret reads the tree it is given and never parses further.
  const source = `first\n\n${'old tail\n\n'.repeat(20000)}\`\`\`\ncode\n\`\`\`\n`
  const parse = new ChunkedMarkdownParser(markdown, markdown).startChunkedParse(
    {
      length: source.length,
      lineChunks: false,
      chunk: (from) => source.slice(from, from + 4096),
      read: (from, to) => source.slice(from, to),
    },
    [],
    { from: 0, to: 8192 },
  )
  let partial = parse.advance()
  while (!partial) partial = parse.advance()
  assert.equal(formattedTextEnd(text(source), partial), source.length - 1)
  assert.equal(
    formattedTextEnd(text(source), markdown.parse(source)),
    source.length - 5,
  )
})
