import type { SyntaxNode } from '@lezer/common'

/** Native custom bodies own bold syntax unless a task or direct list item owns it. */
export function customBody(node: SyntaxNode) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Subtext') return true
    if (parent.name === 'Task') return false
    if (
      parent.name === 'Blockquote' &&
      parent.firstChild?.nextSibling?.name === 'AlertTitle'
    )
      return parent.parent?.name !== 'ListItem'
  }
  return false
}
