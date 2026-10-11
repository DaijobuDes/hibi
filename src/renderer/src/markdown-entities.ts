import type {
  AnyExtension,
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import { decodeHTMLStrict, encodeHTML } from 'entities'
import type { Token } from 'marked'

function decodeMarkdownEntities(text: string) {
  return text.replace(
    /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]+);/g,
    (entity) => decodeHTMLStrict(entity),
  )
}

export function richTextToken(token: Token) {
  if (token.type !== 'text' || token.tokens) return
  // Marked already decodes numeric references in text; raw avoids decoding twice.
  // The distinct token also keeps intentional nbsp out of the empty-paragraph path.
  token.type = 'hibiText'
  token.text = (token.raw ?? token.text).replace(/[ \t]*\n[ \t]*/g, ' ')
}

function encodeInvisibleCharacters(text: string) {
  return text.replace(/[^\S ]|\p{Cf}/gu, (character) => {
    const encoded = encodeHTML(character)
    return encoded === character ? `&#${character.codePointAt(0)};` : encoded
  })
}

function encodeLinkAttribute(text: string) {
  return encodeInvisibleCharacters(text.replace(/[&<>"\\]/g, encodeHTML))
}

export function entityMarkdown(extension: AnyExtension) {
  if (extension.name === 'text')
    return extension.extend({
      markdownTokenName: 'hibiText',
      parseMarkdown: (token: MarkdownToken) => ({
        type: 'text',
        text: token.escaped
          ? (token.text ?? '')
          : decodeMarkdownEntities(token.text ?? ''),
      }),
    })
  if (extension.name === 'link')
    return extension.extend({
      parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
        helpers.applyMark(
          'link',
          token.autolink
            ? [helpers.createTextNode(token.text ?? '')]
            : helpers.parseInline(token.tokens ?? []),
          {
            href: token.autolink
              ? token.href
              : decodeMarkdownEntities(token.href ?? ''),
            title: decodeMarkdownEntities(token.title ?? '') || null,
          },
        ),
      renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => {
        const href = encodeLinkAttribute(node.attrs?.href ?? '').replace(
          /[() ]/g,
          (character) => (character === ' ' ? '&#32;' : encodeHTML(character)),
        )
        const title = encodeLinkAttribute(node.attrs?.title ?? '')
        const text = helpers.renderChildren(node)
        return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`
      },
    })
  return extension
}

// Tiptap bypasses Text's render hook. Keep its private codec adaptation here,
// covered by full and cached serialization regressions when upgrading Tiptap.
type TextCodec = {
  encodeTextForMarkdown: (
    text: string,
    node: JSONContent,
    parent?: JSONContent,
  ) => string
  codeTypes: Set<string>
  isEmptyOutput: (source: string) => boolean
}

const configured = new WeakSet<MarkdownManager>()

export function configureMarkdownEntities(manager: MarkdownManager) {
  if (configured.has(manager)) return
  configured.add(manager)
  const codec = manager as unknown as TextCodec
  const encodeText = codec.encodeTextForMarkdown.bind(manager)
  codec.encodeTextForMarkdown = (text, node, parent) => {
    const encoded = encodeText(text, node, parent)
    if (
      (parent?.type && codec.codeTypes.has(parent.type)) ||
      node.marks?.some((mark) => codec.codeTypes.has(mark.type))
    )
      return encoded
    return encodeInvisibleCharacters(encoded)
  }
  // Empty paragraphs already use blank lines; an intentional nbsp is content.
  codec.isEmptyOutput = (source) => /^[ \t\r\n]*$/.test(source)
}
