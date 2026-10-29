import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState } from '@codemirror/state'
import { InlineContext } from '@lezer/markdown'
import { formattedTree } from '../src/renderer/src/formatted-contributions.ts'
import { sourceFormatting } from '../src/renderer/src/source-formatting.ts'
import {
  formattedInlineParser,
  formattedMarkdownParser,
} from '../src/shared/formatted-markdown.ts'

const cases = [
  ['ab**😀cd**ef', []],
  ['ab**𐩐cd**ef', []],
  ['ab*😀cd*ef', []],
  ['ab*𐩐cd*ef', []],
  ['**ab😀**cd', []],
  ['**ab𐩐**cd', []],
  ['ab**€cd**ef', []],
  ['ab**cd**ef', [['StrongEmphasis', '**cd**']]],
  ['ab😀**cd**ef', [['StrongEmphasis', '**cd**']]],
  ['ab𐩐**cd**ef', [['StrongEmphasis', '**cd**']]],
  ['**😀cd**', [['StrongEmphasis', '**😀cd**']]],
  ['**𐩐cd**', [['StrongEmphasis', '**𐩐cd**']]],
  ['**cd**😀', [['StrongEmphasis', '**cd**']]],
  ['ab**𐐀cd**ef', [['StrongEmphasis', '**𐐀cd**']]],
  ['a__😀b__c', []],
  ['😀__b__😀', [['StrongEmphasis', '__b__']]],
  ['__😀b__', [['StrongEmphasis', '__😀b__']]],
  [
    '***😀cd***',
    [
      ['Emphasis', '***😀cd***'],
      ['StrongEmphasis', '**😀cd**'],
    ],
  ],
  [
    '**a *😀b* c**',
    [
      ['StrongEmphasis', '**a *😀b* c**'],
      ['Emphasis', '*😀b*'],
    ],
  ],
  [
    '*a **😀b** c*',
    [
      ['Emphasis', '*a **😀b** c*'],
      ['StrongEmphasis', '**😀b**'],
    ],
  ],
  ['ab\\*\\*😀cd\\*\\*ef', []],
  ['\uD83D**x**\uDE00', [['StrongEmphasis', '**x**']]],
  ['**😀é**', [['StrongEmphasis', '**😀é**']]],
  ['**\u00a0😀**', []],
  ['**😀\u00a0**', []],
  ['[**😀cd**](url)', [['StrongEmphasis', '**😀cd**']]],
  ['\x60ab**😀cd**ef\x60', []],
  ['*a\n😀b*', [['Emphasis', '*a\n😀b*']]],
]

for (const [name, create] of [
  ['document', formattedMarkdownParser],
  ['table inline', formattedInlineParser],
]) {
  test(`${name} emphasis uses whole Unicode flank characters`, () => {
    const parser = create([])
    for (const [source, expected] of cases) {
      const spans = []
      parser.parse(source).iterate({
        enter(node) {
          if (node.name === 'Emphasis' || node.name === 'StrongEmphasis')
            spans.push([node.name, source.slice(node.from, node.to)])
        },
      })
      assert.deepEqual(spans, expected, JSON.stringify(source))
    }
  })
}

test('formatted toolbar reads Unicode emphasis from the shared grammar', () => {
  for (const [source, expected] of cases) {
    const anchor = source.indexOf('cd')
    if (anchor < 0) continue
    const state = EditorState.create({
      doc: source,
      selection: { anchor: anchor + 1 },
      extensions: formattedTree.of(() =>
        formattedMarkdownParser([]).parse(source),
      ),
    })
    const pressed = sourceFormatting({ state }).inspect().state('bold').pressed
    assert.equal(
      pressed,
      expected.some(([name]) => name === 'StrongEmphasis'),
      JSON.stringify(source),
    )
    assert.equal(state.doc.toString(), source)
  }
})

test('emphasis flank reads stay bounded as context and delimiter runs grow', (t) => {
  const slice = InlineContext.prototype.slice
  const char = InlineContext.prototype.char
  let reads = [],
    chars = 0
  t.mock.method(InlineContext.prototype, 'slice', function (from, to) {
    reads.push(to - from)
    assert.ok(to - from <= 2, 'A flank needs at most one surrogate pair.')
    assert.ok(from >= this.offset, 'Never read before the inline context.')
    return slice.call(this, from, to)
  })
  t.mock.method(InlineContext.prototype, 'char', function (pos) {
    chars++
    return char.call(this, pos)
  })
  const parser = formattedMarkdownParser([])
  for (const size of [0, 16_384, 131_072]) {
    const source = `${'a'.repeat(size + 1)}**😀cd**${'z'.repeat(size + 1)}`
    reads = []
    chars = 0
    assert.deepEqual(parser.parseInline(source, 700), [])
    assert.deepEqual(reads, [Math.min(2, size + 1), 2, 2, 2])
    assert.ok(
      chars <= source.length + 4,
      `${chars} reads for ${source.length} units`,
    )
  }
  const source = `a${'*'.repeat(8192)}😀b**z`
  reads = []
  chars = 0
  assert.deepEqual(parser.parseInline(source, 700), [])
  assert.deepEqual(reads, [1, 2, 2, 2])
  assert.ok(chars <= source.length + 4)
})
