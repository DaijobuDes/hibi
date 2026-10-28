import { NodeProp, Tree } from '@lezer/common'
import {
  type MarkdownConfig,
  type MarkdownExtension,
  parser,
} from '@lezer/markdown'
import { protectMarkdownParser } from './markdown-flavor-guard.ts'
import { ContainerHTML } from './markdown-html-syntax.ts'

/** Facts collected while finding a code span's closing fence, kept on its opening mark. */
export const inlineCodeInfo = new NodeProp<{
  longest: number
  blank: boolean
}>({ perNode: true })

const codeParser = parser.configure({
  parseInline: [
    {
      name: 'InlineCode',
      parse(cx, next, start) {
        if (next !== 96 || (start && cx.char(start - 1) === 96)) return -1
        let pos = start + 1
        while (pos < cx.end && cx.char(pos) === 96) pos++
        const size = pos - start
        let run = 0,
          longest = 0,
          blank = true
        for (; pos < cx.end; pos++) {
          const char = cx.char(pos)
          if (char === 96) {
            run++
            if (run === size && cx.char(pos + 1) !== 96) {
              const mark = cx.elt('CodeMark', start, start + size)
              const opening = new Tree(
                cx.parser.nodeSet.types[mark.type]!,
                [],
                [],
                size,
                [[inlineCodeInfo, { longest, blank }]],
              )
              return cx.addElement(
                cx.elt('InlineCode', start, pos + 1, [
                  cx.elt(opening, start),
                  cx.elt('CodeMark', pos + 1 - size, pos + 1),
                ]),
              )
            }
          } else {
            if (run) {
              longest = Math.max(longest, run)
              blank = false
              run = 0
            }
            if (char !== 32 && char !== 10) blank = false
          }
        }
        return -1
      },
    },
  ],
})

/** The same core grammar and contributed syntax in the formatted view and its worker. */
export function formattedMarkdownParser(
  contributed: readonly MarkdownConfig[],
  extensions: MarkdownExtension = [],
) {
  return protectMarkdownParser(codeParser, [
    { defineNodes: [{ name: 'Frontmatter', block: true }] },
    ContainerHTML,
    ...contributed,
    extensions,
  ])
}

/** The table view's inline-only grammar, shared with worker cell projection. */
export function formattedInlineParser(contributed: readonly MarkdownConfig[]) {
  const inline = protectMarkdownParser(codeParser, contributed)
  const blocks =
    (inline as unknown as { blockNames?: readonly string[] }).blockNames ?? []
  return inline.configure({ remove: [...blocks] })
}
