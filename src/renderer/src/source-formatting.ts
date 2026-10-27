import {
  indentLess,
  indentMore,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import {
  EditorSelection,
  type EditorState,
  Facet,
  type SelectionRange,
  Transaction,
} from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import type {
  DocumentEdit,
  DocumentFormat,
  DocumentSelection,
} from '../../addons/api'
import type { MediaAttachment } from '../../shared/media'
import { formattedSyntaxTree } from './formatted-contributions.ts'

/** Same format actions as the toolbar; addon keymaps (including vim) run first. */
const formatBindings: [string, string][] = [
  ['Mod-b', 'bold'],
  ['Mod-i', 'italic'],
  ['Mod-e', 'inline-code'],
  ['Mod-Shift-x', 'strike'],
  ['Mod-Shift-7', 'numbered-list'],
  ['Mod-Shift-8', 'bullet-list'],
  ['Mod-Shift-9', 'checklist'],
  ['Mod-Shift-b', 'quote'],
  ['Mod-Alt-c', 'code-block'],
  ['Mod-Alt-0', 'paragraph'],
  ...Array.from({ length: 6 }, (_, i): [string, string] => [
    `Mod-Alt-${i + 1}`,
    `heading-${i + 1}`,
  ]),
]
export const formattingKeymap = (run: (id: string) => boolean): KeyBinding[] =>
  formatBindings.map(([key, id]) => ({ key, run: () => run(id) }))

export type InsertValues = { url: string; alt: string }

/** A view's table editing: whether the selection is in a table, and the toolbar's table actions. */
export type TableActions = {
  active: (view: EditorView) => boolean
  run: (view: EditorView, id: string) => boolean
}
export const tableActions = Facet.define<TableActions>()
const tableIds = [
  'row-before',
  'row-after',
  'row-delete',
  'column-before',
  'column-after',
  'column-delete',
  'table-delete',
]
/** Actions that make or change blocks, which a table cell cannot hold. */
const blockIds = [
  'paragraph',
  'subtext',
  'bullet-list',
  'numbered-list',
  'checklist',
  'quote',
  'code-block',
  'divider',
  'table',
  'indent',
  'outdent',
  ...Array.from({ length: 6 }, (_, i) => `heading-${i + 1}`),
]
const inTable = (view: EditorView) =>
  view.state.facet(tableActions).some((actions) => actions.active(view))
export type SourceFormatting = ReturnType<typeof sourceFormatting>
const marks: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  subscript: '~',
  'inline-code': '`',
}
const prefixes: Record<string, string> = {
  'bullet-list': '- ',
  'numbered-list': '1. ',
  checklist: '- [ ] ',
  quote: '> ',
  subtext: '-# ',
}
/** The toolbar's marks by the formatted view's syntax for them. */
const markIds: Record<string, string> = {
  StrongEmphasis: 'bold',
  Emphasis: 'italic',
  Strikethrough: 'strike',
  Subscript: 'subscript',
  InlineCode: 'inline-code',
  Link: 'link',
  Autolink: 'link',
}
const containers = [
  'Document',
  'Blockquote',
  'BulletList',
  'OrderedList',
  'ListItem',
  'ContainerHTML',
]

/**
 * The marks around `from`-`to` and their nodes: formatting whose text holds
 * a caret, which typing there extends, or whose syntax holds a range.
 */
function marksAt(state: EditorState, tree: Tree, from: number, to: number) {
  const found = new Map<string, SyntaxNode>()
  for (
    let node: SyntaxNode | null = tree.resolveInner(from, 1);
    node && !node.type.is('Block');
    node = node.parent
  ) {
    const id = markIds[node.name]
    if (!id || found.has(id)) continue
    const first = node.firstChild
    const last =
      node.name === 'Link'
        ? node
            .getChildren('LinkMark')
            .find((mark) => state.sliceDoc(mark.from, mark.to) === ']')
        : node.lastChild
    if (
      from < to
        ? node.from <= from && to <= node.to
        : !!first && !!last && first.to <= from && from <= last.from
    )
      found.set(id, node)
  }
  return found
}

/** Delimiters the toolbar opened at the caret, with no text between them yet. */
function opened(state: EditorState, pos: number, token: string) {
  const before = state.sliceDoc(Math.max(0, pos - token.length - 1), pos)
  const after = state.sliceDoc(pos, pos + token.length + 1)
  return (
    before.endsWith(token) &&
    after.startsWith(token) &&
    before.at(-token.length - 1) !== token[0] &&
    after[token.length] !== token[0]
  )
}

type Block = {
  /** The action that makes this kind of block, or `other` for literal blocks such as HTML. */
  kind: string
  /** The innermost list item. */
  item: SyntaxNode | null
  /** The actions of the lists around the block. */
  lists: Set<string>
  quote: boolean
}

function blockKind(name: string) {
  // The rich editor's table cells and task items hold paragraphs.
  if (name === 'Paragraph' || name === 'Task' || name === 'Table')
    return 'paragraph'
  if (/^(?:ATX|Setext)Heading[1-6]$/.test(name))
    return `heading-${name.slice(-1)}`
  if (name === 'FencedCode' || name === 'CodeBlock') return 'code-block'
  return name === 'Subtext' ? 'subtext' : 'other'
}

/** The block at `pos`, read up its ancestors; a line between blocks takes a paragraph. */
function blockAt(tree: Tree, pos: number, side: -1 | 1): Block {
  const read = (side: -1 | 1) => {
    const block: Block = {
      kind: '',
      item: null,
      lists: new Set(),
      quote: false,
    }
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      const { name } = node
      if (name === 'ListItem') {
        block.item ??= node
        const mark = node.firstChild
        block.lists.add(
          node.parent?.name === 'OrderedList'
            ? 'numbered-list'
            : mark && node.childAfter(mark.to)?.name === 'Task'
              ? 'checklist'
              : 'bullet-list',
        )
      } else if (name === 'Blockquote') block.quote = true
      else if (
        !block.kind &&
        node.type.is('Block') &&
        !containers.includes(name)
      )
        block.kind = blockKind(name)
    }
    return block
  }
  const block = read(side)
  if (block.kind) return block
  const other = read(side === 1 ? -1 : 1)
  return other.kind ? other : { ...block, kind: 'paragraph' }
}

/**
 * Toolbar states from the formatted view's syntax tree. A range reads the
 * blocks at its two ends, so no selection reads the blocks between them.
 */
function formattedStates(
  state: EditorState,
  tree: Tree,
  range: SelectionRange,
) {
  const start = blockAt(tree, range.from, 1)
  const end = range.empty ? start : blockAt(tree, range.to, -1)
  const inline = marksAt(state, tree, range.from, range.to)
  const both = (test: (block: Block) => boolean) => test(start) && test(end)
  const literal = both(({ kind }) => kind === 'code-block' || kind === 'other')
  const listed = both(({ item }) => !!item)
  const pressed = (id: string) =>
    Object.values(markIds).includes(id)
      ? inline.has(id) ||
        (range.empty && !!marks[id] && opened(state, range.from, marks[id]))
      : id === 'quote'
        ? both(({ quote }) => quote)
        : id === 'bullet-list' || id === 'numbered-list' || id === 'checklist'
          ? both(({ lists }) => lists.has(id))
          : both(({ kind }) => kind === id)
  const disabled = (id: string) => {
    switch (id) {
      case 'bold':
      case 'italic':
      case 'strike':
      case 'subscript':
      case 'link':
        return literal || inline.has('inline-code')
      case 'inline-code':
        return literal
      case 'paragraph':
        return pressed(id)
      case 'subtext':
        return pressed(id) || listed
      case 'quote':
      case 'code-block':
        return listed
      case 'bullet-list':
      case 'numbered-list':
      case 'checklist':
        // A list item starts with a paragraph.
        return !both(({ kind }) => kind === 'paragraph')
      case 'indent': {
        // An item indents under the item before it, in the same list.
        const list = start.item?.parent
        return !(
          start.item &&
          list &&
          start.item.from > list.from &&
          end.item?.parent?.from === list.from
        )
      }
      case 'outdent':
        return !listed
      default:
        return id.startsWith('heading-') && listed
    }
  }
  return { pressed, disabled }
}

const fenceLength = (text: string, minimum = 0) =>
  Array.from(text.matchAll(/`+/g)).reduce(
    (longest, match) => Math.max(longest, match[0].length),
    minimum,
  ) + 1

/** One transaction per action: preserve selections and isolate the undo step. */
function validEdit(
  edit: DocumentEdit | null | undefined,
  length: number,
): edit is DocumentEdit {
  if (
    !edit ||
    !Number.isInteger(edit.from) ||
    !Number.isInteger(edit.to) ||
    edit.from < 0 ||
    edit.to < edit.from ||
    edit.to > length ||
    typeof edit.insert !== 'string'
  )
    return false
  const start = edit.selection?.from ?? edit.insert.length,
    end = edit.selection?.to ?? start
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= edit.insert.length
  )
}

export function sourceFormatting(
  view: EditorView,
  format: DocumentFormat['formatting'] | null = 'markdown',
  media = false,
  history?: {
    undo: () => boolean
    redo: () => boolean
    state: () => { canUndo: boolean; canRedo: boolean }
  },
) {
  const editable = () => !view.state.readOnly
  let lastDocument = view.state.doc,
    text = lastDocument.toString()
  const selection = (values?: InsertValues): DocumentSelection => {
    if (lastDocument !== view.state.doc) {
      lastDocument = view.state.doc
      text = lastDocument.toString()
    }
    const range = view.state.selection.main
    return { source: text, from: range.from, to: range.to, values }
  }
  const supported = (id: string) =>
    ['undo', 'redo', 'indent', 'outdent'].includes(id) ||
    (media && id === 'image') ||
    format === 'markdown' ||
    !!format?.actions.includes(id)
  const applyEdit = (edit: DocumentEdit) => {
    if (!validEdit(edit, view.state.doc.length)) return false
    const start = edit.selection?.from ?? edit.insert.length,
      end = edit.selection?.to ?? start
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: EditorSelection.single(edit.from + start, edit.from + end),
      annotations: [
        Transaction.userEvent.of('input.format'),
        isolateHistory.of('full'),
      ],
      scrollIntoView: true,
    })
    view.focus()
    return true
  }
  const marked = (id: string) => {
    const selection = view.state.selection.main
    const token = marks[id]
    if (id === 'italic') {
      const before = view.state.doc.lineAt(selection.from)
      const after = view.state.doc.lineAt(selection.to)
      return (
        (before.text
          .slice(0, selection.from - before.from)
          .match(/(?<!\\)\*+$/)?.[0].length ?? 0) %
          2 ===
          1 &&
        (after.text.slice(selection.to - after.from).match(/^\*+/)?.[0]
          .length ?? 0) %
          2 ===
          1
      )
    }
    return (
      !!token &&
      view.state.sliceDoc(
        Math.max(0, selection.from - token.length),
        selection.from,
      ) === token &&
      view.state.sliceDoc(selection.to, selection.to + token.length) === token
    )
  }
  const run = (id: string, values?: InsertValues) => {
    if (!editable() || !supported(id)) return false
    if (blockIds.includes(id) && inTable(view)) return false
    if (id === 'undo' || id === 'redo' || id === 'indent' || id === 'outdent') {
      const done = {
        undo: history?.undo ?? undo,
        redo: history?.redo ?? redo,
        indent: indentMore,
        outdent: indentLess,
      }[id](view)
      view.focus()
      return done
    }
    if (view.state.selection.ranges.length !== 1) return false
    // A table writes a cell's line break as `<br>`.
    if (tableIds.includes(id) || (id === 'hard-break' && inTable(view)))
      return view.state
        .facet(tableActions)
        .some((actions) => actions.run(view, id))
    const range = view.state.selection.main
    const doc = view.state.doc
    let from = range.from,
      to = range.to
    const selected = doc.sliceString(from, to)
    let insert = selected,
      start = 0,
      end = selected.length
    const token = marks[id]
    if (format !== 'markdown') {
      const edit = format?.apply(id, selection(values))
      if (!validEdit(edit, doc.length)) return false
      from = edit.from
      to = edit.to
      insert = edit.insert
      start = edit.selection?.from ?? insert.length
      end = edit.selection?.to ?? start
      if (
        ![start, end].every(Number.isInteger) ||
        start < 0 ||
        end < start ||
        end > insert.length
      )
        return false
    } else if (token) {
      if (marked(id)) {
        from -= token.length
        to += token.length
      } else if (
        selected.startsWith(token) &&
        selected.endsWith(token) &&
        selected.length >= token.length * 2 &&
        (id !== 'italic' ||
          ((selected.match(/^\*+/)?.[0].length ?? 0) % 2 === 1 &&
            (selected.match(/(?<!\\)\*+$/)?.[0].length ?? 0) % 2 === 1))
      ) {
        insert = selected.slice(token.length, -token.length)
        end = insert.length
      } else {
        const delimiter =
          id === 'inline-code' ? '`'.repeat(fenceLength(selected)) : token
        const pad = id === 'inline-code' && /^`|`$/.test(selected) ? ' ' : ''
        insert = `${delimiter}${pad}${selected}${pad}${delimiter}`
        start = delimiter.length + pad.length
        end = start + selected.length
      }
    } else if (
      id === 'paragraph' ||
      id.startsWith('heading-') ||
      prefixes[id]
    ) {
      from = doc.lineAt(from).from
      to = doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to).to
      const lines = doc.sliceString(from, to).split('\n')
      const prefix = id.startsWith('heading-')
        ? `${'#'.repeat(Number(id.slice(-1)))} `
        : (prefixes[id] ?? '')
      const existing =
        /^( {0,3})(?:#{1,6} |[-+*] (?:\[[ xX]\] )?|\d+[.)] |> |-# )/
      const remove =
        !!prefix &&
        lines.every((line) =>
          id === 'numbered-list'
            ? /^\s*\d+[.)] /.test(line)
            : id === 'checklist'
              ? /^\s*[-+*] \[[ xX]\] /.test(line)
              : line.trimStart().startsWith(prefix),
        )
      insert = lines
        .map((line, index) => {
          const body = line.replace(existing, '$1')
          return remove || id === 'paragraph'
            ? body
            : body.replace(
                /^( {0,3})/,
                `$1${id === 'numbered-list' ? `${index + 1}. ` : prefix}`,
              )
        })
        .join('\n')
      start = range.empty
        ? Math.max(
            0,
            Math.min(
              insert.length,
              range.from - from + insert.length - (to - from),
            ),
          )
        : 0
      end = range.empty ? start : insert.length
    } else if (id === 'link' || id === 'image') {
      if (!values) return false
      const label = (
        id === 'image' ? values.alt : selected || values.url
      ).replace(/[\\[\]]/g, '\\$&')
      const url = values.url
        .replace(/\\/g, '\\\\')
        .replace(/[()]/g, '\\$&')
        .replace(/ /g, '%20')
      insert = `${id === 'image' ? '!' : ''}[${label}](${url})`
      end = insert.length
    } else if (id === 'unlink') {
      // Like the rich editor, a caret in a link removes that link.
      const tree = range.empty ? formattedSyntaxTree(view.state) : null
      const link = tree && marksAt(view.state, tree, from, to).get('link')
      if (link) {
        from = link.from
        to = link.to
      }
      insert = doc
        .sliceString(from, to)
        .replace(/\[([^\]]+)\]\((?:\\.|[^)])*\)/g, '$1')
      end = insert.length
    } else {
      const fence = '`'.repeat(fenceLength(selected, 2))
      // A view that edits tables in place inserts the rich editor's table: a
      // header and two empty rows, with the caret in the first header cell.
      const cells = id === 'table' && view.state.facet(tableActions).length > 0
      const block =
        id === 'code-block'
          ? `${fence}\n${selected}\n${fence}`
          : id === 'divider'
            ? '---'
            : cells
              ? '|  |  |\n| --- | --- |\n|  |  |\n|  |  |'
              : id === 'table'
                ? '| column 1 | column 2 |\n| --- | --- |\n|  |  |'
                : null
      if (id === 'hard-break') {
        insert = '  \n'
        start = end = insert.length
      } else if (block !== null) {
        const before =
          from && !doc.sliceString(0, from).endsWith('\n\n')
            ? doc.sliceString(0, from).endsWith('\n')
              ? '\n'
              : '\n\n'
            : ''
        const after =
          to < doc.length && !doc.sliceString(to).startsWith('\n\n')
            ? doc.sliceString(to).startsWith('\n')
              ? '\n'
              : '\n\n'
            : '\n\n'
        insert = before + block + after
        start =
          id === 'code-block'
            ? before.length + fence.length + 1
            : cells
              ? before.length + 2
              : insert.length
        end = id === 'code-block' ? start + selected.length : start
      } else return false
    }
    // An action that changes no Markdown leaves the note unedited.
    if (format === 'markdown' && insert === doc.sliceString(from, to))
      return false
    return applyEdit({ from, to, insert, selection: { from: start, to: end } })
  }
  const inspect = () => {
    const state = view.state
    const range = state.selection.main
    const tree = format === 'markdown' ? formattedSyntaxTree(state) : null
    // The formatted view reads its syntax tree; a source pane reads the selection's line.
    const formatted = tree && formattedStates(state, tree, range)
    const line =
      format === 'markdown' && !formatted
        ? state.doc.lineAt(range.from).text.trimStart()
        : ''
    let activeSelection: DocumentSelection | undefined
    const selected = () => {
      if (!activeSelection) activeSelection = selection()
      return activeSelection
    }
    const table = inTable(view)
    return {
      /** The selection is in a table whose actions this view runs. */
      table,
      state(id: string, checkPressed = true) {
        if (!supported(id))
          return { supported: false, pressed: false, disabled: true }
        if (tableIds.includes(id))
          return {
            supported: true,
            pressed: false,
            disabled:
              state.readOnly || !table || state.selection.ranges.length !== 1,
          }
        const blockActive = id.startsWith('heading-')
          ? line.startsWith(`${'#'.repeat(Number(id.slice(-1)))} `)
          : id === 'numbered-list'
            ? /^\d+[.)] /.test(line)
            : id === 'bullet-list'
              ? /^[-+*] (?!\[[ xX]\] )/.test(line)
              : id === 'checklist'
                ? /^[-+*] \[[ xX]\] /.test(line)
                : prefixes[id]
                  ? line.startsWith(prefixes[id])
                  : false
        return {
          supported: true,
          pressed:
            checkPressed &&
            (formatted
              ? formatted.pressed(id)
              : format === 'markdown'
                ? marked(id) || blockActive
                : (format?.isActive?.(id, { ...selected() }) ?? false)),
          disabled:
            state.readOnly ||
            (table && blockIds.includes(id)) ||
            (state.selection.ranges.length !== 1 &&
              !['undo', 'redo', 'indent', 'outdent'].includes(id)) ||
            (id === 'undo'
              ? !(history ? history.state().canUndo : undoDepth(state))
              : id === 'redo'
                ? !(history ? history.state().canRedo : redoDepth(state))
                : formatted
                  ? formatted.disabled(id)
                  : id === 'unlink' &&
                    !/\[[^\]]+\]\(/.test(state.sliceDoc(range.from, range.to))),
        }
      },
    }
  }
  return {
    focus: () => view.focus(),
    run,
    state(id: string) {
      return inspect().state(id)
    },
    inspect,
    capture(coords?: { x: number; y: number }) {
      const doc = view.state.doc,
        position = coords ? view.posAtCoords(coords) : null,
        selection =
          position == null
            ? view.state.selection
            : EditorSelection.single(position)
      return {
        text: view.state.sliceDoc(selection.main.from, selection.main.to),
        insertMarkdown(insert: string) {
          if (!view.dom.isConnected || view.state.doc !== doc || !editable())
            return false
          const { from, to } = selection.main
          return applyEdit({ from, to, insert })
        },
        insertMedia(items: readonly MediaAttachment[]) {
          if (
            !format ||
            format === 'markdown' ||
            !view.dom.isConnected ||
            view.state.doc !== doc ||
            !editable()
          )
            return false
          let source = doc.toString(),
            from = selection.main.from,
            to = selection.main.to
          for (const [index, values] of items.entries()) {
            if (index) {
              source = source.slice(0, from) + '\n\n' + source.slice(from)
              from += 2
              to = from
            }
            const edit = format.apply(
              /\.(mp4|webm|ogv|mov)$/i.test(values.url) ? 'link' : 'image',
              { source, from, to, values },
            )
            if (!validEdit(edit, source.length)) return false
            source =
              source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
            from = to = edit.from + (edit.selection?.to ?? edit.insert.length)
          }
          return applyEdit({
            from: 0,
            to: doc.length,
            insert: source,
            selection: { from, to },
          })
        },
        run(id: string, values: InsertValues) {
          if (!view.dom.isConnected || view.state.doc !== doc) return false
          view.dispatch({ selection })
          return run(id, values)
        },
      }
    },
  }
}
