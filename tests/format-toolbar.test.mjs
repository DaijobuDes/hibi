import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { formatLanguage } from '../src/addons/_shared/format-language.ts'
import { formatToolbar } from '../src/addons/_shared/format-toolbar.ts'

const apply = (
  provider,
  action,
  source,
  from = 0,
  to = source.length,
  values,
) => {
  const edit = provider.apply(action, { source, from, to, values })
  assert.ok(edit, action)
  return {
    edit,
    source: source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
  }
}

test('native source highlighting recognizes the syntax written by its toolbar', () => {
  const highlighter = tagHighlighter([
    { tag: tags.strong, class: 'bold' },
    { tag: tags.emphasis, class: 'italic' },
    { tag: tags.monospace, class: 'inline-code' },
  ])
  for (const reader of [
    'rst',
    'asciidoc',
    'org',
    'mediawiki',
    'creole',
    'djot',
  ]) {
    const language = formatLanguage({ reader }, () => null)
    for (const action of ['bold', 'italic', 'inline-code']) {
      const { source } = apply(formatToolbar(reader), action, 'word')
      const spans = []
      highlightTree(
        language.parser.parse(source),
        highlighter,
        (from, to, classes) => {
          spans.push({ text: source.slice(from, to), classes })
        },
      )
      assert.ok(
        spans.some(
          (span) => span.text.includes('word') && span.classes.includes(action),
        ),
        `${reader} ${action}: ${JSON.stringify(spans)}`,
      )
    }
  }
})

test('native formatting wraps selections and toggles without changing surrounding text', () => {
  for (const name of [
    'typst',
    'latex',
    'html',
    'rst',
    'asciidoc',
    'org',
    'mediawiki',
    'creole',
    'textile',
    'djot',
  ]) {
    const provider = formatToolbar(name)
    assert.notEqual(provider, 'markdown')
    const first = apply(provider, 'bold', 'before word after', 7, 11)
    assert.ok(first.source.startsWith('before '), name)
    assert.ok(first.source.endsWith(' after'), name)
    const second = apply(
      provider,
      'bold',
      first.source,
      first.edit.from + first.edit.selection.from,
      first.edit.from + first.edit.selection.to,
    )
    assert.equal(second.source, 'before word after', name)
  }
  for (const name of ['mdx', 'mdsvex', 'markdoc', 'markdown'])
    assert.equal(formatToolbar(name), 'markdown')
})

test('heading and list conversions preserve body text across native formats', () => {
  assert.equal(
    apply(formatToolbar('mediawiki'), 'heading-1', '* item').source,
    '= item =',
  )
  assert.equal(
    apply(formatToolbar('creole'), 'paragraph', '# item').source,
    'item',
  )
  assert.equal(
    apply(formatToolbar('html'), 'paragraph', '<h2>item</h2>').source,
    '<p>item</p>',
  )
  assert.equal(
    apply(formatToolbar('rst'), 'paragraph', 'Heading\n=======', 0, 0).source,
    'Heading',
  )
  assert.equal(
    apply(formatToolbar('typst'), 'heading-2', 'item', 2, 2).source,
    '== item',
  )
  assert.equal(
    apply(formatToolbar('org'), 'bullet-list', 'one\ntwo').source,
    '- one\n- two',
  )
  assert.equal(
    apply(formatToolbar('textile'), 'heading-3', 'word').source,
    'h3. word',
  )
  assert.equal(
    apply(formatToolbar('asciidoc'), 'heading-2', '\nword', 0, 0).source,
    '== \nword',
  )
})

test('LaTeX inserts required packages once and keeps link/image paths intact', () => {
  const source =
    '\\documentclass{article}\n\\begin{document}\nword\n\\end{document}'
  const start = source.indexOf('word')
  const provider = formatToolbar('latex')
  const linked = apply(provider, 'link', source, start, start + 4, {
    url: 'https://example.com?a=1&b=2',
    alt: '',
  }).source
  assert.match(linked, /\\usepackage\{hyperref\}/)
  assert.match(linked, /\\href\{https:\/\/example\.com\?a=1\\&b=2\}\{word\}/)
  const again = apply(provider, 'link', linked, linked.length, linked.length, {
    url: 'https://example.com',
    alt: 'More',
  }).source
  assert.equal(again.match(/\\usepackage\{hyperref\}/g).length, 1)
  const image = apply(provider, 'image', source, start, start, {
    url: 'assets/my%20image.png',
    alt: '',
  }).source
  assert.match(image, /\\usepackage\{graphicx\}/)
  assert.match(image, /\\includegraphics\{assets\/my image\.png\}/)
})
