import {
  type AnyExtension,
  getExtensionField,
  type MarkdownTokenizer,
} from '@tiptap/core'
import { Table, TableKit } from '@tiptap/extension-table'
import type { Node } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { cellAround, TableMap } from '@tiptap/pm/tables'
import { ReplaceStep } from '@tiptap/pm/transform'

const native = getExtensionField<MarkdownTokenizer>(Table, 'markdownTokenizer')

function firstTwoLines(source: string) {
  const first = source.indexOf('\n')
  if (first < 0) return source
  const second = source.indexOf('\n', first + 1)
  return second < 0 ? source : source.slice(0, second)
}

/** Native table detection only inspects two lines, never the remaining document. */
export function guardNativeTableTokenizer(extension: AnyExtension) {
  const tokenizer = getExtensionField<MarkdownTokenizer | undefined>(
    extension,
    'markdownTokenizer',
  )
  const start = native.start
  if (tokenizer !== native || typeof start !== 'function') return extension
  const tokenize = native.tokenize
  return extension.extend({
    markdownTokenizer: {
      ...native,
      start: (source: string) => start(firstTwoLines(source)),
      tokenize(...args: Parameters<MarkdownTokenizer['tokenize']>) {
        const prefix = firstTwoLines(args[0]),
          newline = prefix.indexOf('\n')
        // Tokenization requires the same delimiter as start(), but does not
        // require a pipe in the header. Supply one only for that check.
        if (newline < 0 || start(`|${prefix.slice(newline)}`) !== 0)
          return undefined
        return tokenize(...args)
      },
    },
  })
}

/** Calls `visit` for each table in `node` that `old` does not share, as prosemirror-tables' fixTables finds them. */
function changedTables(
  old: Node,
  node: Node,
  offset: number,
  visit: (table: Node, position: number) => void,
) {
  for (let index = 0, kept = 0; index < node.childCount; index++) {
    const child = node.child(index),
      end = Math.min(old.childCount, index + 3)
    let scan = kept
    while (scan < end && old.child(scan) !== child) scan++
    if (scan < end) kept = scan + 1
    else if (child.type.spec.tableRole === 'table') visit(child, offset)
    else if (!child.isTextblock)
      changedTables(
        old.maybeChild(kept)?.sameMarkup(child)
          ? old.child(kept)
          : child.copy(),
        child,
        offset + 1,
        visit,
      )
    offset += child.nodeSize
  }
}

/**
 * Native table edits read back as their Markdown does: a table that lost its
 * header row gets the empty one its source writes, and text typed over a range
 * across cells leaves the caret after it.
 */
function nativeTableInput() {
  // Text typed over a range across cells, until ProseMirror reads its edit.
  let typed: string | null = null
  return new Plugin({
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          const { selection } = view.state
          const from = cellAround(selection.$from),
            to = cellAround(selection.$to)
          typed =
            event.inputType === 'insertText' &&
            event.data &&
            !/[\r\n]/.test(event.data) &&
            !view.composing &&
            selection instanceof TextSelection &&
            from &&
            to &&
            from.pos !== to.pos
              ? event.data
              : null
          return false
        },
      },
    },
    appendTransaction(transactions, oldState, state) {
      const text = typed,
        read = transactions[0],
        step = read?.steps[0],
        tr = state.tr
      typed = null
      if (oldState.doc === state.doc) return null
      // ProseMirror places the browser's caret by the document it parsed, which
      // can hold fewer cells than the one its step makes: in front of the typed
      // text, its first occurrence from there on.
      if (text && read && step instanceof ReplaceStep) {
        const after = read.mapping.slice(1)
        let end = -1
        step.slice.content.descendants((node, position) => {
          for (
            let at = node.isText && end < 0 ? node.text!.indexOf(text) : -1;
            at >= 0 && end < 0;
            at = node.text!.indexOf(text, at + 1)
          ) {
            const start = step.from - step.slice.openStart + position + at
            if (after.map(start) >= read.selection.head)
              end = start + text.length
          }
          return end < 0
        })
        if (end >= 0) {
          let caret = after.map(end)
          for (const later of transactions.slice(1))
            caret = later.mapping.map(caret)
          tr.setSelection(TextSelection.create(state.doc, caret))
        }
      }
      const { tableHeader, tableRow } = state.schema.nodes
      if (tableHeader && tableRow)
        changedTables(oldState.doc, state.doc, 0, (table, position) => {
          if (
            table.firstChild?.content.content.some(
              (cell) => cell.type === tableHeader,
            )
          )
            return
          const map = TableMap.get(table)
          const cells = Array.from(
            { length: map.width },
            (_, column) =>
              tableHeader.createAndFill({
                align: table.nodeAt(map.map[column]!)?.attrs.align ?? null,
              })!,
          )
          tr.insert(tr.mapping.map(position + 1), tableRow.create(null, cells))
        })
      return tr.docChanged || tr.selectionSet ? tr : null
    },
  })
}

export const NativeTableKit = TableKit.extend({
  addExtensions() {
    return this.parent?.().map(guardNativeTableTokenizer) ?? []
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), nativeTableInput()]
  },
})
