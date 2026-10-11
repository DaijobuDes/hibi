import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState } from '@tiptap/pm/state'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import { markdownSerializer } from '../src/renderer/src/markdown-serialization.ts'
import { markdownSyntax } from '../src/renderer/src/markdown-syntax.ts'

const { core, parser, options } = markdownConfiguration([])
const schema = getSchema(core)
const manager = new MarkdownManager({
  extensions: core,
  marked: parser,
  markedOptions: options,
})

for (const source of [
  '<kbd>x</kbd>',
  'a <span class="x">b</span> c',
  '<div>\nx\n</div>',
  '<!-- comment -->',
  '<details><summary>s</summary>\n\nbody\n\n</details>',
  'a<br>b',
  'a<BR />b',
  'a <span title=">">*b* &copy; <span>c</span></span> d',
  'a <!-- inline\ncomment --> b',
  '<script>window.attack = true</script>',
  'a <img src="x" onerror="window.attack = true"> b',
  'a <span>unclosed',
  '<kbd>x\n\ny</kbd>',
  '**<kbd>x</kbd>**',
  '**a <span>x</span> b**',
  '[<kbd>x</kbd>](https://example.com)',
  '*before <span>inside* after</span>',
  '> <div>\n> x\n> </div>',
]) {
  test(`raw html round-trips without a DOM: ${JSON.stringify(source)}`, () => {
    const doc = schema.nodeFromJSON(manager.parse(source))
    doc.check()
    assert.equal(manager.serialize(doc.toJSON()), source)
    const original = `${source}\n\nelsewhere`
    const before = schema.nodeFromJSON(manager.parse(original))
    const state = EditorState.create({ schema, doc: before })
    const after = state.apply(
      state.tr.insertText('!', before.content.size - 1),
    ).doc
    for (const blockLocal of [true, false]) {
      const serialize = markdownSerializer(manager, blockLocal)
      assert.equal(serialize(before).source, original)
      assert.equal(serialize(after).source, `${original}!`)
      assert.ok(
        schema.nodeFromJSON(manager.parse(serialize(after).source)).eq(after),
      )
    }
  })
}

test('inline and block html are selectable atoms, while br keeps its source spelling', () => {
  const inline = schema.nodeFromJSON(manager.parse('<kbd>x</kbd>')).firstChild
    .firstChild
  assert.equal(inline.type.name, 'rawHtmlInline')
  assert.equal(inline.attrs.source, '<kbd>x</kbd>')
  assert.ok(inline.isAtom && inline.type.spec.selectable)
  assert.equal(inline.childCount, 0)
  const block = schema.nodeFromJSON(
    manager.parse('<div>\nx\n</div>'),
  ).firstChild
  assert.equal(block.type.name, 'rawHtmlBlock')
  assert.equal(block.attrs.source, '<div>\nx\n</div>')
  assert.ok(block.isAtom && block.type.spec.selectable)
  const br = schema.nodeFromJSON(manager.parse('a<br>b')).firstChild.child(1)
  assert.equal(br.type.name, 'hardBreak')
  assert.equal(br.attrs.rawHtml, '<br>')
})

test('html br becomes an opaque chip when line breaks are disabled', () => {
  markdownSyntax.setEnabled('core.line-breaks', false)
  try {
    const { core, parser, options } = markdownConfiguration([])
    const manager = new MarkdownManager({
      extensions: core,
      marked: parser,
      markedOptions: options,
    })
    const schema = getSchema(core)
    const doc = schema.nodeFromJSON(manager.parse('a<br>b'))
    doc.check()
    assert.equal(doc.firstChild.child(1).type.name, 'rawHtmlInline')
    assert.equal(manager.serialize(doc.toJSON()), 'a<br>b')
  } finally {
    markdownSyntax.setEnabled('core.line-breaks', true)
  }
})
