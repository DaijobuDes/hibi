import {
  InlineContext,
  type MarkdownConfig,
  type MarkdownExtension,
  parser,
} from '@lezer/markdown'
import { protectMarkdownParser } from './markdown-flavor-guard.ts'
import { ContainerHTML } from './markdown-html-syntax.ts'

const UnicodeEmphasis: MarkdownConfig = {
  parseInline: [
    {
      name: 'Emphasis',
      parse(cx, next, from) {
        if (next !== 42 && next !== 95) return -1
        let to = from + 1
        while (cx.char(to) === next) to++
        // A flank is one code point, even when it occupies two UTF-16 units.
        const before =
          cx.slice(Math.max(cx.offset, from - 2), from).match(/.$/su)?.[0] ?? ''
        const after = cx.slice(to, to + 2).match(/^./su)?.[0] ?? ''
        const pBefore = /[\p{P}\p{S}]/u.test(before),
          pAfter = /[\p{P}\p{S}]/u.test(after)
        const sBefore = /\s|^$/.test(before),
          sAfter = /\s|^$/.test(after)
        const left = !sAfter && (!pAfter || sBefore || pBefore)
        const right = !sBefore && (!pBefore || sAfter || pAfter)
        return cx.addDelimiter(
          next === 42
            ? InlineContext.emphasisAsterisk
            : InlineContext.emphasisUnderscore,
          from,
          to,
          left && (next === 42 || !right || pBefore),
          right && (next === 42 || !left || pAfter),
        )
      },
    },
  ],
}

const coreParser = parser.configure(UnicodeEmphasis)

/** The same core grammar and contributed syntax in the formatted view and its worker. */
export function formattedMarkdownParser(
  contributed: readonly MarkdownConfig[],
  extensions: MarkdownExtension = [],
) {
  return protectMarkdownParser(coreParser, [
    { defineNodes: [{ name: 'Frontmatter', block: true }] },
    ContainerHTML,
    ...contributed,
    extensions,
  ])
}

/** The table view's inline-only grammar, shared with worker cell projection. */
export function formattedInlineParser(contributed: readonly MarkdownConfig[]) {
  const inline = protectMarkdownParser(coreParser, contributed)
  const blocks =
    (inline as unknown as { blockNames?: readonly string[] }).blockNames ?? []
  return inline.configure({ remove: [...blocks] })
}
