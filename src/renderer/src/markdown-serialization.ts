import type { JSONContent } from '@tiptap/core'
import { ORDERED_LIST_MARKER_PATTERN } from '@tiptap/extension-list'
import type { MarkdownManager } from '@tiptap/markdown'
import type { Node } from '@tiptap/pm/model'
import type { Marked } from 'marked'
import { configureMarkdownEntities } from './markdown-entities.ts'

const orderedPrefix = new RegExp(
  `^( {0,3}(?:${ORDERED_LIST_MARKER_PATTERN}))([.)])(?=[^\\S\\n])`,
)

/** Finish inline escaping with the syntax that only has meaning at block starts. */
export function escapeParagraphMarkdown(source: string, parser: Marked) {
  const lines = source.split('\n')
  for (const [index, value] of lines.entries()) {
    let line = value
    // Tiptap already escapes *, _, backticks, ~, brackets, and HTML characters.
    if (
      /^ {0,3}(?:#{1,6}(?=\s|$)|[-+](?=[ \t]|$)|-(?:[ \t]*-){2,}[ \t]*$)/.test(
        line,
      )
    )
      line = line.replace(/^( *)/, '$1\\')
    else
      line = line
        .replace(orderedPrefix, '$1\\$2')
        .replace(/^( {0,3}\d+)([.)])$/, '$1\\$2')
    const previous = lines[index - 1]
    if (previous?.trim()) {
      if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line))
        line = line.replace(/^( *)/, '$1\\')
      else if (
        parser.defaults.gfm &&
        /^ {0,3}[|:\t -]*-[|:\t -]*$/.test(line) &&
        parser
          .lexer(`${previous}\n${line}`)
          .some((token) => token.type === 'table')
      )
        line = line.replace('-', '\\-')
    }
    lines[index] = line
  }
  return lines.join('\n')
}

/** Block caching is opt-in: arbitrary addon serializers may depend on the whole document. */
export function markdownSerializer(
  manager: MarkdownManager,
  blockLocal: boolean,
) {
  configureMarkdownEntities(manager)
  const json = new WeakMap<Node, JSONContent>()
  const blocks = new WeakMap<
    Node,
    {
      previous: Node | undefined
      index: number
      attributes: Node['attrs']
      source: string
    }
  >()
  const asJSON = (node: Node) => {
    const cached = json.get(node)
    if (cached) return cached
    const value: JSONContent = node.toJSON()
    json.set(node, value)
    return value
  }
  return (doc: Node) => {
    const children: Node[] = []
    doc.forEach((node) => {
      children.push(node)
    })
    if (
      !blockLocal ||
      doc.marks.length ||
      children.some((node) => node.marks.length)
    ) {
      const source = manager.serialize(doc.toJSON())
      return {
        source,
        rendered: children.length,
        blocks: null,
      }
    }
    const parent: JSONContent = {
      type: doc.type.name,
      ...(Object.keys(doc.attrs).length ? { attrs: doc.attrs } : {}),
      content: children.map(asJSON),
    }
    let rendered = 0
    const parts = children.map((node, index) => {
      const previous = children[index - 1]
      let cached = blocks.get(node)
      if (
        !cached ||
        cached.previous !== previous ||
        cached.index !== index ||
        cached.attributes !== doc.attrs
      ) {
        const source = manager.renderNodeToMarkdown(
          asJSON(node),
          parent,
          index,
          0,
        )
        cached = {
          previous,
          index,
          attributes: doc.attrs,
          source,
        }
        blocks.set(node, cached)
        rendered++
      }
      return cached
    })
    const joined = parts.map((block) => block.source).join('\n\n')
    // Match the manager's empty-document normalization, including blank paragraphs.
    const source = /^[ \t\r\n]*$/.test(joined) ? '' : joined
    return { source, rendered, blocks: parts }
  }
}
