import type { SyntaxNode } from '@lezer/common'

/** Native custom tokenizers parse these features before schema preferences apply. */
export const customBodyFeatures = new Set([
  'core.bold',
  'core.italic',
  'core.links',
  'markdown.strike',
  ...Array.from({ length: 6 }, (_, index) => `core.heading-${index + 1}`),
])

export const customBodyNodes = new Set([
  'StrongEmphasis',
  'Emphasis',
  'Link',
  'Autolink',
  'URL',
  'Strikethrough',
  ...Array.from({ length: 6 }, (_, index) => `ATXHeading${index + 1}`),
  'SetextHeading1',
  'SetextHeading2',
])

/** Native custom bodies own parsing, including task text and inline subscripts. */
export function customBody(node: SyntaxNode) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Subtext' || parent.name === 'Subscript') return true
    if (
      parent.name === 'Blockquote' &&
      parent.firstChild?.nextSibling?.name === 'AlertTitle'
    )
      return (
        parent.parent?.name !== 'ListItem' ||
        parent.parent.parent?.name === 'OrderedList'
      )
  }
  return false
}

/** Direct bullet alerts contain raw text in the native model, even with syntax enabled. */
function rawBody(node: SyntaxNode) {
  if (node.name === 'AlertTitle' || node.name === 'QuoteMark') return false
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'AlertTitle') return false
    if (
      parent.name === 'Blockquote' &&
      parent.firstChild?.nextSibling?.name === 'AlertTitle'
    )
      return (
        parent.parent?.name === 'ListItem' &&
        parent.parent.parent?.name === 'BulletList'
      )
  }
  return false
}

/** One literal-scope decision for renderer, tables, retained leaves and worker projection. */
export function literalText(
  node: SyntaxNode,
  literal: ReadonlySet<string>,
  body = customBody(node),
) {
  return (
    rawBody(node) ||
    (literal.has(node.name) && !(body && customBodyNodes.has(node.name)))
  )
}
