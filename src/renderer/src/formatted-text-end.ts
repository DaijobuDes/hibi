import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { parseRow } from '../../shared/markdown-table-source.ts'
import { uncovered } from './chunked-markdown.ts'

/** Blocks the rich editor reads; it drops link reference definitions. */
const isBlock = (node: SyntaxNode) =>
  node.type.is('Block') && node.name !== 'LinkReference'

function lastBlock(node: SyntaxNode) {
  for (let child = node.lastChild; child; child = child.prevSibling)
    if (isBlock(child)) return child
  return null
}

/** The end of the text before `at`, past whitespace. */
function trimmed(doc: Text, at: number, from = 0) {
  while (at > from && /\s/.test(doc.sliceString(at - 1, at))) at--
  return at
}

/**
 * The end of a table's last cell's text. The rich editor's rows have every
 * column, so its last cell is the last column's; a row with fewer cells has
 * no text for it, and ends in its last written cell here.
 */
function tableEnd(doc: Text, table: SyntaxNode) {
  let header = table.firstChild,
    row = table.lastChild
  while (header && header.name !== 'TableHeader') header = header.nextSibling
  while (row && row.name !== 'TableRow' && row.name !== 'TableHeader')
    row = row.prevSibling
  if (!header || !row) return trimmed(doc, table.to)
  const columns = parseRow(doc.sliceString(header.from, header.to)).cells.length
  const { cells } = parseRow(doc.sliceString(row.from, row.to), row.from)
  return (cells[columns - 1] ?? cells.at(-1))?.to ?? trimmed(doc, row.to)
}

/**
 * Where the rich editor's Selection.atEnd puts the caret, in the formatted
 * view's text: the end of the last text block, inside quotes and lists. In a
 * table that is its last cell's text, which the table's cell editor takes;
 * in code, the code's end before its closing fence. Blank lines after the
 * last block that show an empty paragraph hold it instead. Otherwise, as
 * when the syntax tree does not reach the note's end yet or `drawn` says a
 * renderer draws a fence in place of its text, the end of the source text.
 */
export function formattedTextEnd(
  doc: Text,
  tree: Tree | null,
  drawn: (pos: number) => boolean = () => true,
) {
  const end = trimmed(doc, doc.length)
  if (!tree || uncovered(tree, Math.max(0, end - 1), doc.length)) return end
  let node = lastBlock(tree.topNode)
  if (!node) return end
  // As the formatted view lays out blank lines after the last block: an empty
  // line with a line break after it is the margin above an empty paragraph,
  // which shows on the next line.
  let shown = false,
    paragraph = -1
  for (let number = doc.lineAt(node.to).number + 1; number <= doc.lines; ) {
    const line = doc.line(number++)
    if (line.text.trim()) {
      paragraph = -1
      break
    }
    if (shown) {
      shown = false
      paragraph = line.from
    } else if (!line.text && number <= doc.lines) shown = true
  }
  if (paragraph >= 0) return paragraph
  for (let inner = lastBlock(node); inner; inner = lastBlock(inner))
    node = inner
  if (node.name === 'Table') return tableEnd(doc, node)
  if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
    let text = node.lastChild
    while (text && text.name !== 'CodeText') text = text.prevSibling
    // The view draws no lines for an empty fence.
    if (!text) return end
    // An unclosed fence's text holds the note's last line breaks.
    let at = text.to
    while (at > text.from && /[\r\n]/.test(doc.sliceString(at - 1, at))) at--
    return node.name === 'CodeBlock' || drawn(at) ? at : end
  }
  // A heading's text ends before its closing marks or setext underline.
  const mark = node.lastChild
  const at =
    mark?.name === 'HeaderMark' && mark.from > node.from
      ? node.name.startsWith('Setext')
        ? doc.lineAt(mark.from).from
        : mark.from
      : node.to
  return trimmed(doc, at, node.from)
}

/** Whether the view draws a position's text, not a widget that replaces it, such as a rendered fence's. */
export const drawsText = (view: EditorView, pos: number) =>
  view.visibleRanges.some(({ from, to }) => from <= pos && pos <= to) &&
  view.state.facet(EditorView.decorations).every((source) => {
    let replaced = false
    ;(typeof source === 'function' ? source(view) : source).between(
      pos,
      pos,
      (from, to, value) => {
        if (value.point && from < pos && pos < to) replaced = true
      },
    )
    return !replaced
  })
