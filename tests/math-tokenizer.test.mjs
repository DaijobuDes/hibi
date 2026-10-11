import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema } from '@tiptap/core'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { MarkdownManager } from '@tiptap/markdown'
import { Marked } from 'marked'
import {
  blockMath,
  inlineMath,
  mathFlavor,
  mathTokens,
} from '../src/addons/math/syntax.ts'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import { preserveRichSource } from '../src/renderer/src/rich-source-preservation.ts'
import { markdownSourceParser } from '../src/shared/markdown-source-references.ts'

const fixtures = [
  ['$$x$$', 1],
  ['text $$x$$', 0],
  ['text $$x$$ more', 0],
  ['x$$x$$', 0],
  ['text\n$$x$$', 1],
  ['$$\nx\n$$', 1],
  [' $$x$$', 1],
  ['  $$x$$', 1],
  ['   $$x$$', 1],
  ['text\n   $$x$$', 1],
  ['   $$\nx\n   $$', 1],
  ['    $$x$$', 0],
  ['\t$$x$$', 0],
  ['text\n    $$x$$', 0],
  ['- item\n\n  $$x$$', 1],
  ['- text $$x$$', 0],
  ['- text $$x$$ more', 0],
  ['- item\n\n  $$\n  x\n  $$', 1],
  ['> $$x$$', 1],
  ['> $$\n> x\n> $$', 1],
  ['> text $$x$$', 0],
  ['> text $$x$$ more', 0],
  ['$5 and $$10', 0],
  ['\\$$', 0],
  ['\\$$x$$', 0],
  ['text \\$$x$$ more', 0],
  ['`$$x$$`', 0],
  ['```tex\n$$x$$\n```', 0],
]

function mathParser() {
  const extensions = [InlineMath, BlockMath].map((extension) => {
    const syntax = mathTokens.extensions.find(
      ({ name }) => name === extension.name,
    )
    return extension.extend({
      markdownTokenizer: {
        name: syntax.name,
        level: syntax.level,
        start: syntax.start,
        tokenize: syntax.tokenizer,
      },
    })
  })
  const { parser, options, core, addons } = markdownConfiguration([
    {
      id: 'math.latex',
      richExtensions: extensions,
      export: { extensions: [mathTokens] },
    },
  ])
  const all = [...core, ...addons]
  return {
    schema: getSchema(all),
    manager: new MarkdownManager({
      extensions: all,
      marked: parser,
      markedOptions: options,
    }),
  }
}

test('display math starts only at line boundaries in visual and source tokenizers', () => {
  const parsers = [
    new Marked(mathTokens),
    markdownSourceParser({ gfm: false, math: true }),
  ]
  for (const parser of parsers) {
    for (const [source, expected] of fixtures) {
      const tokens = parser.lexer(source)
      let blocks = 0
      parser.walkTokens(tokens, (token) => {
        if (token.type === 'blockMath') blocks++
        assert.notEqual(token.type, 'inlineMath', source)
      })
      assert.equal(blocks, expected, source)
      assert.equal(tokens.map(({ raw }) => raw).join(''), source, source)
      assert.equal(mathFlavor.detect(source), expected > 0, source)
    }
  }
})

test('display math start hints and tokenizer agree on indentation and real newlines', () => {
  const start = mathTokens.extensions.find(
    ({ name }) => name === 'blockMath',
  ).start
  for (const indent of ['', ' ', '  ', '   ']) {
    const source = `${indent}$$x$$`
    assert.equal(blockMath(source)?.raw, source)
    const tail = `text\n${source}`
    const at = start(tail)
    assert.ok(at >= 0)
    assert.ok(blockMath(tail.slice(at)))
  }
  for (const source of [
    '$$x$$',
    ' $$x$$',
    'text $$x$$',
    'text $$x$$ more',
    '\\$$x$$',
    'text\n    $$x$$',
  ])
    assert.ok(start(source) === undefined || start(source) < 0, source)
  for (const source of [
    'text $$x$$',
    'text $$x$$ more',
    '    $$x$$',
    '\t$$x$$',
    '\\$$x$$',
  ])
    assert.equal(blockMath(source), undefined, source)
  assert.equal(inlineMath('$x$')?.latex, 'x')
})

test('math paragraphs retain literal text without inserted line breaks', () => {
  const { manager, schema } = mathParser()
  for (const source of [
    'text $$x$$',
    'text $$x$$ more',
    'x$$x$$',
    '$5 and $$10',
    '\\$$x$$',
  ]) {
    const doc = schema.nodeFromJSON(manager.parse(source))
    assert.equal(doc.childCount, 1, source)
    assert.equal(doc.firstChild.type.name, 'paragraph', source)
    assert.equal(doc.textContent, source.replace('\\$', '$'), source)
  }
})

test('math round-trips preserve bytes through unrelated rich edits', () => {
  const { manager, schema } = mathParser()
  for (const [fixture, expected] of fixtures) {
    for (const eol of ['\n', '\r\n']) {
      for (const ending of ['', eol]) {
        const source = `${fixture}\n\nanchor`.replaceAll('\n', eol) + ending
        const doc = schema.nodeFromJSON(manager.parse(source))
        doc.check()
        let blocks = 0
        doc.descendants((node) => {
          if (node.type.name === 'blockMath') blocks++
        })
        assert.equal(blocks, expected, source)
        const before = manager.serialize(doc.toJSON())
        assert.equal(
          preserveRichSource(source, before, before, (candidate) =>
            schema.nodeFromJSON(manager.parse(candidate)).eq(doc),
          ),
          source,
        )
        const changed = structuredClone(doc.toJSON())
        changed.content.at(-1).content[0].text = 'changed'
        const next = schema.nodeFromJSON(changed)
        const after = manager.serialize(changed)
        assert.equal(
          preserveRichSource(source, before, after, (candidate) =>
            schema.nodeFromJSON(manager.parse(candidate)).eq(next),
          ),
          source.replace('anchor', 'changed'),
        )
      }
    }
  }
})
