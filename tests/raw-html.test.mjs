import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState } from '@tiptap/pm/state'
import { markdownConfiguration } from '../src/renderer/src/markdown.ts'
import { markdownSerializer } from '../src/renderer/src/markdown-serialization.ts'
import { markdownSyntax } from '../src/renderer/src/markdown-syntax.ts'
import { clipboardHtml } from '../src/renderer/src/RawHtml.ts'
import { preserveRichSource } from '../src/renderer/src/rich-source-preservation.ts'

const { core, parser, options } = markdownConfiguration([])
const schema = getSchema(core)
const manager = new MarkdownManager({
  extensions: core,
  marked: parser,
  markedOptions: options,
})

for (const source of [
  '<kbd>x</kbd>',
  '<kbd>&copy;</kbd>',
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
  '<img src=x onerror=alert(1)>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<style>body { display: none }</style>',
  'a <style>body { display: none }</style> b',
  'a <span>unclosed',
  '<kbd>x\n\ny</kbd>',
  '**<kbd>x</kbd>**',
  '**a<br>b**',
  '[a<br>b](https://example.com)',
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

test('entities adjacent to html chips decode while chip source stays raw', () => {
  const doc = schema.nodeFromJSON(
    manager.parse('&copy;<kbd>&copy;</kbd>&#169;'),
  )
  doc.check()
  assert.equal(doc.firstChild.child(0).text, '©')
  assert.equal(doc.firstChild.child(1).type.name, 'rawHtmlInline')
  assert.equal(doc.firstChild.child(1).attrs.source, '<kbd>&copy;</kbd>')
  assert.equal(doc.firstChild.child(2).text, '©')
  for (const blockLocal of [true, false]) {
    const source = markdownSerializer(manager, blockLocal)(doc).source
    assert.equal(source, '©<kbd>&copy;</kbd>©')
    assert.ok(schema.nodeFromJSON(manager.parse(source)).eq(doc))
  }
})

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

test('block html excludes trailing newlines and list edits keep original spacing', () => {
  const source = '- a\n\n  <div>x</div>\n\n- b'
  const before = schema.nodeFromJSON(manager.parse(source))
  assert.equal(
    before.firstChild.firstChild.lastChild.attrs.source,
    '<div>x</div>',
  )
  const state = EditorState.create({ schema, doc: before })
  const after = state.apply(
    state.tr.insertText('!', before.content.size - 3),
  ).doc
  for (const blockLocal of [true, false]) {
    const serialize = markdownSerializer(manager, blockLocal)
    assert.equal(serialize(before).source, '- a\n  <div>x</div>\n- b')
    assert.equal(
      preserveRichSource(
        source,
        serialize(before).source,
        serialize(after).source,
        (candidate) => schema.nodeFromJSON(manager.parse(candidate)).eq(after),
      ),
      `${source}!`,
    )
  }
  assert.equal(
    schema.nodeFromJSON(manager.parse('<div>x</div>\n')).firstChild.attrs
      .source,
    '<div>x</div>',
  )
})

test('clipboard normalization extracts the exact hosted Windows fragment', () => {
  const copied =
    '<span data-raw-html="inline" class="hibi-literal-inline" contenteditable="false" data-pm-slice="0 0 []"><code>&lt;kbd&gt;y&lt;/kbd&gt;</code></span>'
  const received =
    '<html>\r\n<body>\r\n<!--StartFragment--><span data-raw-html="inline" class="hibi-literal-inline" contenteditable="false" data-pm-slice="0 0 []"><code>&lt;kbd&gt;y&lt;/kbd&gt;</code></span><!--EndFragment-->\r\n</body>\r\n</html>'
  assert.equal(clipboardHtml(received), copied)
  for (const changed of [
    received.replace('y&lt;', 'forged&lt;'),
    received.replace('data-raw-html="inline"', 'data-raw-html="block"'),
    received.replace('&lt;kbd&gt;', '&#60;kbd&#62;'),
    received.replace('<!--StartFragment-->', '<!--StartFragment--> '),
    received.replace('<!--EndFragment-->', '\n<!--EndFragment-->'),
    received.replace('<!--EndFragment-->', ''),
    received.replace('<!--StartFragment-->', ''),
  ])
    assert.notEqual(clipboardHtml(changed), copied)
})

test('clipboard normalization strips document envelopes and native meta prefixes', () => {
  for (const fragment of [
    '<span data-raw-html="inline"><code>&lt;kbd&gt;x&lt;/kbd&gt;</code></span>',
    '<pre data-raw-html="block"><code>&lt;div&gt;\n  x &amp; y\n&lt;/div&gt;</code></pre>',
    '<p>a<br data-raw-html-break="&lt;BR /&gt;">b</p>',
  ]) {
    for (const html of [
      fragment,
      `<meta charset="utf-8">${fragment}`,
      `<meta charset='UTF-8'>${fragment}`,
      `<html>\r\n<head><meta charset="utf-8"></head>\r\n<body>${fragment}</body>\r\n</html>`,
      `<html>\r\n<body>\r\n<!--StartFragment-->${fragment}<!--EndFragment-->\r\n</body>\r\n</html>`,
    ])
      assert.equal(clipboardHtml(html), fragment)
  }
})

test('clipboard fragments keep whitespace, entities, and inner tags byte-for-byte', () => {
  for (const fragment of [
    '  <span><code>&lt;kbd&gt;x&lt;/kbd&gt;</code></span>\r\n',
    '<pre><code>&lt;html&gt;\n&lt;head&gt;&lt;meta charset="utf-8"&gt;&lt;/head&gt;\n&lt;body&gt;&lt;/body&gt;&lt;/html&gt;</code></pre>',
    '<span><meta charset="utf-8"><code>x</code></span>',
  ]) {
    assert.equal(clipboardHtml(fragment), fragment)
    assert.equal(
      clipboardHtml(
        `<html><body>outside<!--StartFragment-->${fragment}<!--EndFragment-->outside</body></html>`,
      ),
      fragment,
    )
  }
})

test('external break attributes cannot inject raw markdown', () => {
  const rule = schema.nodes.hardBreak.spec.parseDOM.find(
    (rule) => rule.tag === 'br',
  )
  for (const session of [null, 'external']) {
    const attrs = rule.getAttrs({
      getAttribute: (name) =>
        name === 'data-raw-html-session'
          ? session
          : '<script>alert(1)</script>',
    })
    assert.equal(schema.nodes.hardBreak.create(attrs).attrs.rawHtml, null)
  }
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
