import type { ChangeSpec, EditorState, SelectionRange } from '@codemirror/state'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import {
  formattedFormatting,
  formattedLiteral,
} from './formatted-contributions.ts'

/*
 * Toolbar states in the formatted view, read from its syntax tree the way the
 * rich editor reads its document. A caret takes the marks of the text before
 * it, or after it at the start of a block. A range is active for a mark all
 * of its text holds, and for a block that covers it, counted as the rich
 * editor counts positions: one per character of text and one for each
 * block's start and end. A caret reads the syntax around it, and a range
 * reads only the syntax inside it.
 */

/** The toolbar's marks by the syntax that writes them. */
const markIds: Record<string, string> = {
  StrongEmphasis: 'bold',
  Emphasis: 'italic',
  Strikethrough: 'strike',
  Subscript: 'subscript',
  InlineCode: 'inline-code',
  Link: 'link',
  Autolink: 'link',
  URL: 'link',
}
const marks = ['bold', 'italic', 'strike', 'subscript', 'inline-code', 'link']
/** Each action's syntax, which a disabled syntax feature shows as text. */
const actionNodes: Record<string, string> = {
  bold: 'StrongEmphasis',
  italic: 'Emphasis',
  strike: 'Strikethrough',
  subscript: 'Subscript',
  'inline-code': 'InlineCode',
  link: 'Link',
  quote: 'Blockquote',
  'bullet-list': 'BulletList',
  'numbered-list': 'OrderedList',
  checklist: 'BulletList',
  'code-block': 'FencedCode',
  divider: 'HorizontalRule',
  'hard-break': 'HardBreak',
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `heading-${level}`,
      `ATXHeading${level}`,
    ]),
  ),
}
const lists = ['bullet-list', 'numbered-list', 'checklist']
const containers = [
  'Document',
  'Blockquote',
  'BulletList',
  'OrderedList',
  'ListItem',
  'ContainerHTML',
  'Table',
  'TableHeader',
  'TableRow',
]

/** The text of inline formatting, between its opening and closing syntax. */
function formattingText(state: EditorState, node: SyntaxNode) {
  // A bare web address is all text.
  if (node.name === 'URL') return { from: node.from, to: node.to }
  const first = node.firstChild
  let last = node.lastChild
  // A link's text ends at its `]`, a few nodes before its end.
  if (node.name === 'Link')
    while (
      last &&
      !(last.name === 'LinkMark' && state.sliceDoc(last.from, last.to) === ']')
    )
      last = last.prevSibling
  return first && last && first !== last && first.to <= last.from
    ? { from: first.to, to: last.from }
    : null
}

/** A link's own address, which belongs to the link around it. */
const linkAddress = (node: SyntaxNode) =>
  node.name === 'URL' &&
  (node.parent?.name === 'Autolink' || node.parent?.name === 'Link')

/** Syntax inside a block that the formatted view hides or draws as something else. */
const blockSyntax = (node: SyntaxNodeRef) =>
  node.name.endsWith('Mark') ||
  node.name === 'TaskMarker' ||
  node.name === 'CodeInfo' ||
  node.name === 'HardBreak' ||
  node.name === 'Image' ||
  node.name === 'TableDelimiter'

/** A text block, or a table cell, which holds a paragraph in the rich editor. */
const isLeaf = (node: SyntaxNodeRef) =>
  node.name === 'TableCell' ||
  (node.type.is('Block') && !containers.includes(node.name))

/** The rich editor's node for a block: an action, or the kind of container. */
function blockType(node: SyntaxNode) {
  const { name } = node
  if (name === 'Paragraph' || name === 'Task' || name === 'TableCell')
    return 'paragraph'
  if (/^(?:ATX|Setext)Heading[1-6]$/.test(name))
    return `heading-${name.slice(-1)}`
  if (name === 'FencedCode' || name === 'CodeBlock') return 'code-block'
  if (name === 'Subtext') return 'subtext'
  if (name === 'Blockquote') return 'quote'
  if (name === 'OrderedList') return 'numbered-list'
  if (name === 'BulletList')
    return node.firstChild ? listOf(node.firstChild) : 'bullet-list'
  if (containers.includes(name)) return name
  return 'other'
}

/** The list item's list action: a task list, numbered or bulleted. */
function listOf(item: SyntaxNode) {
  if (item.parent?.name === 'OrderedList') return 'numbered-list'
  const mark = item.firstChild
  return mark && item.childAfter(mark.to)?.name === 'Task'
    ? 'checklist'
    : 'bullet-list'
}

type Block = { node: SyntaxNode | null; kind: string }

function blockOf(node: SyntaxNode | null): Block {
  for (let at = node; at; at = at.parent)
    if (isLeaf(at)) return { node: at, kind: blockType(at) }
  return { node: null, kind: '' }
}

/** The block a caret at `pos` types into; a line between blocks takes a paragraph. */
function blockAt(tree: Tree, pos: number): Block {
  const after = blockOf(tree.resolveInner(pos, 1))
  if (after.node) return after
  const before = blockOf(tree.resolveInner(pos, -1))
  return before.node ? before : { node: null, kind: 'paragraph' }
}

/** Where a text block's text starts, after its own markers. */
function textStart(state: EditorState, block: SyntaxNode) {
  let at = block.from
  for (
    let child = block.firstChild;
    child && child.from <= at + 1 && blockSyntax(child);
    child = child.nextSibling
  )
    at = child.to
  while (at < block.to && /[ \t]/.test(state.sliceDoc(at, at + 1))) at++
  if (block.name === 'FencedCode' && state.sliceDoc(at, at + 1) === '\n') at++
  return at
}

function textEnd(block: SyntaxNode) {
  const last = block.lastChild
  return block.name === 'FencedCode' && last?.name === 'CodeMark'
    ? Math.max(block.from, last.from - 1)
    : block.to
}

/** The formatting names that are not shown as text. */
function formattingNames(state: EditorState) {
  const literal = state.facet(formattedLiteral)
  return [...Object.keys(markIds), ...state.facet(formattedFormatting)].filter(
    (name) => !literal.includes(name),
  )
}

/**
 * The formatting holding the character at `pos`, innermost first, or the
 * formatting syntax that the character belongs to.
 */
function inlineAt(
  state: EditorState,
  tree: Tree,
  pos: number,
  formatting: readonly string[],
) {
  const found = new Map<string, SyntaxNode>()
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, 1);
    node && !isLeaf(node) && !containers.includes(node.name);
    node = node.parent
  ) {
    if (!formatting.includes(node.name) || linkAddress(node)) continue
    const text = formattingText(state, node)
    if (!text) continue
    if (pos < text.from) return { syntax: { from: node.from, to: text.from } }
    if (pos >= text.to) return { syntax: { from: text.to, to: node.to } }
    const id = markIds[node.name]
    if (id && !found.has(id)) found.set(id, node)
  }
  return { marks: found }
}

/**
 * The rich editor's marks at a caret: those of the text before it, or of the
 * text after it at the start of its block. A mark that typing at its end does
 * not extend, like subscript, holds only inside its text.
 */
export function caretMarks(state: EditorState, tree: Tree, pos: number) {
  const { node: block, kind } = blockAt(tree, pos)
  const none = new Map<string, SyntaxNode>()
  if (!block || kind === 'code-block' || kind === 'other') return none
  const formatting = formattingNames(state)
  const start = textStart(state, block),
    end = textEnd(block)
  let before: Map<string, SyntaxNode> | null = null,
    after: Map<string, SyntaxNode> | null = null
  for (let at = pos; at > start; ) {
    const found = inlineAt(state, tree, at - 1, formatting)
    if (found.marks) {
      before = found.marks
      break
    }
    at = found.syntax.from
  }
  for (let at = pos; at < end; ) {
    const found = inlineAt(state, tree, at, formatting)
    if (found.marks) {
      after = found.marks
      break
    }
    at = found.syntax.to
  }
  const main = before ?? after
  if (!main) return none
  const other = before ? after : null
  if (main.has('subscript') && !other?.has('subscript'))
    main.delete('subscript')
  return main
}

/**
 * The formatting whose text holds `pos`, innermost first: where typing at a
 * caret there goes, which can differ from the marks the toolbar shows.
 */
export function formattingAt(state: EditorState, tree: Tree, pos: number) {
  const formatting = formattingNames(state)
  const found = new Map<string, SyntaxNode>()
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, 1);
    node && !isLeaf(node) && !containers.includes(node.name);
    node = node.parent
  ) {
    if (!formatting.includes(node.name) || linkAddress(node)) continue
    const text = formattingText(state, node)
    const id = markIds[node.name]
    if (text && id && !found.has(id) && text.from <= pos && pos <= text.to)
      found.set(id, node)
  }
  return found
}

/** Formatting of mark `id` that ends at `pos`, so that text typed there can join it. */
export function formattingBefore(
  state: EditorState,
  tree: Tree,
  pos: number,
  id: string,
) {
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, -1);
    node && !isLeaf(node) && !containers.includes(node.name);
    node = node.parent
  )
    if (node.to === pos && markIds[node.name] === id)
      return formattingText(state, node)
  return null
}

/**
 * What a range holds, counted as the rich editor counts positions: the text
 * that can take marks, the text under each mark, and each block's share of
 * the range.
 */
function rangeContent(
  state: EditorState,
  tree: Tree,
  from: number,
  to: number,
) {
  const formatting = formattingNames(state)
  const leaves: SyntaxNode[] = []
  const covered = new Map<string, number>()
  const shares = new Map<string, number>()
  const stack: { type: string; units: number }[] = []
  let units = 0,
    markable = 0,
    plain = 0
  const add = (count: number) => {
    units += count
    for (const frame of stack) frame.units += count
  }
  const open = (type: string, inside: boolean) => {
    stack.push({ type, units: 0 })
    if (inside) add(1)
  }
  const close = (inside: boolean) => {
    if (inside) add(1)
    const frame = stack.pop()
    if (frame)
      shares.set(frame.type, (shares.get(frame.type) ?? 0) + frame.units)
  }
  const count = (start: number, end: number, ids: Set<string> | null) => {
    if (end <= start) return
    const length = end - start
    add(length)
    if (!ids) return
    for (const id of ids) covered.set(id, (covered.get(id) ?? 0) + length)
    markable += length
    if (!ids.has('inline-code')) plain += length
  }
  // Text runs between the syntax of the block being read, with their marks,
  // and the closing syntax of open formatting, such as a link's destination.
  let runs: { id: string; to: number }[] = []
  let tails: { from: number; to: number }[] = []
  let block: {
    from: number
    to: number
    end: number
    cell: boolean
  } | null = null
  let cursor = from
  const flush = (until: number) => {
    if (!block) return
    const start = Math.max(cursor, from)
    const end = Math.min(until, to, block.end)
    if (end > start)
      count(
        start,
        end,
        new Set(runs.filter((mark) => mark.to > start).map(({ id }) => id)),
      )
    cursor = Math.max(cursor, until)
  }
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (isLeaf(node)) {
        const leaf = node.node
        leaves.push(leaf)
        const start = textStart(state, leaf),
          end = textEnd(leaf)
        const cell = node.name === 'TableCell'
        if (cell) open('TableCell', from < start)
        const kind = blockType(leaf)
        open(kind, from < start)
        // Code and literal blocks hold text that takes no marks.
        if (kind === 'code-block' || kind === 'other') {
          count(Math.max(start, from), Math.min(end, to), null)
          close(to > end)
          return false
        }
        block = { from: node.from, to: node.to, end, cell }
        cursor = Math.max(from, start)
        runs = []
        tails = []
        return undefined
      }
      if (!block) {
        if (node.name !== 'Document' && containers.includes(node.name))
          open(blockType(node.node), node.from > from)
        return undefined
      }
      if (
        blockSyntax(node) ||
        tails.some((tail) => node.from >= tail.from && node.from < tail.to)
      ) {
        flush(node.from)
        cursor = Math.max(cursor, node.to)
        return false
      }
      if (!formatting.includes(node.name)) return undefined
      const inner = formattingText(state, node.node)
      if (!inner) return undefined
      flush(node.from)
      cursor = Math.max(cursor, inner.from)
      const id = markIds[node.name]
      if (id) runs.push({ id, to: inner.to })
      tails.push({ from: inner.to, to: node.to })
      return undefined
    },
    leave: (node) => {
      if (block && node.from === block.from && node.to === block.to) {
        flush(block.end)
        close(to > block.end)
        if (block.cell) close(to > block.end)
        block = null
        return
      }
      if (!block) {
        if (node.name !== 'Document' && containers.includes(node.name))
          close(node.to < to)
        return
      }
      if (!formatting.includes(node.name)) return
      const inner = formattingText(state, node.node)
      if (!inner) return
      flush(inner.to)
      runs = runs.filter((mark) => mark.to !== inner.to)
      tails = tails.filter((tail) => tail.to !== node.to)
      cursor = Math.max(cursor, node.to)
    },
  })
  return { leaves, units, covered, shares, markable, plain }
}

/** A block's ancestors as the rich editor nests them: a table cell holds its paragraph. */
function ancestors(block: SyntaxNode | null) {
  const out: SyntaxNode[] = []
  if (block?.name === 'TableCell') out.push(block)
  for (let at = block?.parent ?? null; at; at = at.parent) out.push(at)
  return out
}

/** The first block of a list item, after its marker. */
const firstInItem = (item: SyntaxNode) =>
  item.firstChild ? item.childAfter(item.firstChild.to) : null

/** Toolbar states from the formatted view's syntax tree. */
export function formattedStates(
  state: EditorState,
  tree: Tree,
  range: SelectionRange,
) {
  const literal = state.facet(formattedLiteral)
  const unsupported = (id: string) =>
    !!actionNodes[id] && literal.includes(actionNodes[id])
  const content = range.empty
    ? null
    : rangeContent(state, tree, range.from, range.to)
  // A range of syntax alone is a caret in the rich editor.
  const caret = !content?.units
  const leaves: Block[] =
    !caret && content?.leaves.length
      ? content.leaves.map((node) => ({ node, kind: blockType(node) }))
      : [blockAt(tree, range.from)]
  const first = leaves[0] as Block,
    last = leaves.at(-1) as Block
  const atCaret = caret ? caretMarks(state, tree, range.from) : null
  const chain = ancestors(first.node)
  const holds = (node: SyntaxNode) =>
    !last.node || (node.from <= last.node.from && node.to >= last.node.to)
  // The node whose children the selection's blocks are, as the rich editor ranges blocks.
  const parent =
    chain.find((node) => holds(node) || node.name === 'Document') ?? null
  /** The child of that node that holds the selection's start. */
  const head = parent ? (chain[chain.indexOf(parent) - 1] ?? first.node) : null
  const blockActive = (type: string) =>
    caret
      ? first.kind === type || chain.some((node) => blockType(node) === type)
      : (content?.shares.get(type) ?? 0) >= (content?.units ?? 0)
  const markActive = (id: string) => {
    if (atCaret) return atCaret.has(id)
    // Code blocks take no marks, so their text does not count; inline code
    // excludes every other mark, so its text counts for them beside text that holds it.
    const matched = content?.covered.get(id) ?? 0
    if (!content?.markable || !matched) return false
    const excluded =
      id === 'inline-code' ? 0 : (content.covered.get('inline-code') ?? 0)
    return matched + excluded >= content.markable
  }
  const pressed = (id: string): boolean =>
    !unsupported(id) && (marks.includes(id) ? markActive(id) : blockActive(id))
  const canMark = (id: string) => {
    if (atCaret)
      return (
        first.kind !== 'code-block' &&
        first.kind !== 'other' &&
        (id === 'inline-code' || atCaret.has(id) || !atCaret.has('inline-code'))
      )
    return id === 'inline-code'
      ? (content?.markable ?? 0) > 0
      : (content?.plain ?? 0) > 0
  }
  /**
   * A block of the selection that can become `type`. Literal blocks, such
   * as math or HTML, are atoms in the rich editor, and a list item starts
   * with a paragraph.
   */
  const convertible = (type: string) =>
    leaves.some(
      ({ node, kind }) =>
        kind !== type &&
        kind !== 'other' &&
        !(
          node?.parent?.name === 'ListItem' &&
          firstInItem(node.parent)?.from === node.from
        ),
    )
  const listAbove = chain.find(
    (node) => node.name === 'BulletList' || node.name === 'OrderedList',
  )
  /** The list holding the whole selection whose items are, or are not, tasks. */
  const itemList = () => {
    const tasks = pressed('checklist')
    return chain.find(
      (node) =>
        (node.name === 'BulletList' || node.name === 'OrderedList') &&
        holds(node) &&
        (blockType(node) === 'checklist') === tasks,
    )
  }
  const disabled = (id: string): boolean => {
    if (unsupported(id)) return true
    if (marks.includes(id)) return !pressed(id) && !canMark(id)
    if (id === 'paragraph' || id === 'subtext') return !convertible(id)
    if (id.startsWith('heading-') || id === 'code-block')
      return !pressed(id) && !convertible(id)
    if (id === 'quote') {
      if (pressed(id)) return false
      // A quote wraps the parent's blocks where the parent can hold one.
      if (!parent) return false
      if (parent.name === 'ListItem')
        return head?.from === firstInItem(parent)?.from
      return [
        'BulletList',
        'OrderedList',
        'Table',
        'TableHeader',
        'TableRow',
      ].includes(parent.name)
    }
    if (lists.includes(id)) {
      // In a list, the action lifts its items or changes the list's kind.
      if (
        listAbove &&
        parent &&
        parent.name !== 'Document' &&
        chain.indexOf(listAbove) - chain.indexOf(parent) <= 1
      )
        return false
      // Otherwise it wraps the blocks, and a list item starts with a paragraph.
      return !(
        head === first.node &&
        first.kind === 'paragraph' &&
        (first.node?.name !== 'TableCell' || parent === first.node)
      )
    }
    if (id === 'indent') {
      // An item indents under the item before it, in the same list.
      const items = itemList()
      const item = items && chain[chain.indexOf(items) - 1]
      return !item || item.from <= (items?.from ?? 0)
    }
    if (id === 'outdent') return !itemList()
    return false
  }
  return { pressed, disabled }
}

/** Changes that remove the links around a caret or inside a range, keeping their text. */
export function unlinkChanges(
  state: EditorState,
  tree: Tree,
  range: SelectionRange,
): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  const unlink = (node: SyntaxNode) => {
    // A bare web address links itself, as it does in the rich editor after a reload.
    if (node.name === 'URL') return
    const text =
      node.name === 'Autolink'
        ? node.getChild('URL')
        : formattingText(state, node)
    if (text)
      changes.push(
        { from: node.from, to: text.from },
        { from: text.to, to: node.to },
      )
  }
  if (range.empty) {
    const link = caretMarks(state, tree, range.from).get('link')
    if (link) unlink(link)
    return changes
  }
  tree.iterate({
    from: range.from,
    to: range.to,
    enter: (node) => {
      if (node.to <= range.from || node.from >= range.to) return false
      if (node.name === 'Link' || node.name === 'Autolink') {
        unlink(node.node)
        return false
      }
      return undefined
    },
  })
  return changes
}

/** Changes that turn the fenced code blocks of a selection back into text. */
export function unfenceChanges(
  tree: Tree,
  range: SelectionRange,
): ChangeSpec[] | null {
  const fences: SyntaxNode[] = []
  if (range.empty) {
    const block = blockAt(tree, range.from).node
    if (block) fences.push(block)
  } else
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (!isLeaf(node)) return undefined
        fences.push(node.node)
        return false
      },
    })
  if (!fences.length || fences.some((node) => node.name !== 'FencedCode'))
    return null
  return fences.flatMap((node) => {
    // The code between the fences keeps the containers' markers on its lines.
    let text = node.firstChild
    while (text && text.name !== 'CodeText') text = text.nextSibling
    let end = node.lastChild
    while (end && end.name !== 'CodeText') end = end.prevSibling
    if (!text || !end) return [{ from: node.from, to: node.to }]
    return [
      { from: node.from, to: text.from },
      { from: end.to, to: node.to },
    ]
  })
}
