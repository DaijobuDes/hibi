import assert from 'node:assert/strict'
import test from 'node:test'
import { GFM, parser } from '@lezer/markdown'
import {
  formattedInlineParser,
  formattedMarkdownParser,
  inlineCodeInfo,
} from '../src/shared/formatted-markdown.ts'

const grammar = formattedMarkdownParser(GFM)
const original = parser.configure(GFM)

function nodes(tree) {
  const result = []
  tree.iterate({
    enter: ({ name, from, to }) => result.push([name, from, to]),
  })
  return result
}

test('code summaries preserve the commonmark tree and source positions', () => {
  const fixtures = [
    '> `a\n> b`',
    '- `a\n  b`',
    '> ` \n>  `',
    '[a `b`](url)',
    '| a | `b` |\n| - | - |\n| c | d |',
    '```\ncode\n```',
    '\\`a`',
  ]
  const alphabet = ['a', '`', ' ', '\n', '\t', '\\']
  let words = ['']
  for (let length = 0; length <= 4; length++) {
    for (const word of words)
      for (const fence of ['`', '``', '```'])
        fixtures.push('a ' + fence + word + fence + ' z')
    words = words.flatMap((word) => alphabet.map((char) => word + char))
  }
  for (const source of fixtures)
    assert.deepEqual(
      nodes(grammar.parse(source)),
      nodes(original.parse(source)),
      JSON.stringify(source),
    )
})

test('code summaries exclude fences and normalize only line breaks as spaces', () => {
  for (const [body, fence, longest, blank] of [
    ['   ', '`', 0, true],
    [' \n ', '`', 0, true],
    [' \t ', '`', 0, false],
    ['a`b', '``', 1, false],
    ['a``b`c', '```', 2, false],
    ['a```b', '`', 3, false],
  ]) {
    const source = 'a ' + fence + body + fence
    const tree = grammar.parse(source)
    let info
    tree.iterate({
      enter(node) {
        if (node.name === 'InlineCode')
          info = node.node.firstChild.prop(inlineCodeInfo)
      },
    })
    assert.deepEqual(info, { longest, blank }, source)
    const inline = formattedInlineParser(GFM).parseInline(source, 0)
    assert.ok(inline.length > 0)
  }
})
