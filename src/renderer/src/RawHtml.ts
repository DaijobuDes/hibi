import {
  type AnyExtension,
  getExtensionField,
  type JSONContent,
  Node,
} from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import type { Token } from 'marked'
import { markdownSyntax } from './markdown-syntax.ts'

const clipboardSession = crypto.randomUUID()

const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(
    ' ',
  ),
)

/** Keep paired inline HTML together without sending workspace markup to a DOM parser. */
export function preserveInlineHtml(tokens: Token[]) {
  if (!tokens.some((token) => token?.type === 'html' && !token.block))
    return tokens
  const stack: { name: string; index: number }[] = []
  const ends = new Map<number, number>()
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'html' || token.block) continue
    const tag = /^<(\/?)([a-z][\w:-]*)\b/i.exec(token.raw)
    if (!tag?.[2]) continue
    const name = tag[2].toLowerCase()
    if (tag[1]) {
      if (stack.at(-1)?.name === name) {
        const start = stack.pop()!
        ends.set(start.index, index)
      } else stack.length = 0
    } else if (!voidTags.has(name) && !/\/>$/.test(token.raw))
      stack.push({ name, index })
  }
  const result: Token[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.type !== 'html' || token.block) {
      result.push(token)
      continue
    }
    const end = ends.get(index) ?? index
    const raw = tokens
      .slice(index, end + 1)
      .map((part) => part.raw)
      .join('')
    result.push({ type: 'rawHtmlInline', raw, text: raw })
    index = end
  }
  tokens.length = 0
  for (const token of result) tokens.push(token)
  return tokens
}

/** Keep break spelling and marked HTML fragments outside Tiptap's text-only mark handling. */
export function preserveHtml(extension: AnyExtension) {
  if (extension.name === 'hardBreak')
    return extension.extend({
      addAttributes: () => ({ rawHtml: { default: null, rendered: false } }),
      renderMarkdown: (node: JSONContent) => node.attrs?.rawHtml ?? '  \n',
    })
  if (
    extension.type === 'mark' &&
    getExtensionField(extension, 'parseMarkdown')
  )
    return extension.extend({
      parseMarkdown(token, helpers) {
        const result = this.parent?.(token, helpers)
        if (
          result &&
          'mark' in result &&
          result.content?.some(
            (node) => node.type === 'rawHtmlInline' || node.attrs?.rawHtml,
          )
        )
          return helpers.createNode('rawHtmlInline', { source: token.raw })
        return result ?? null
      },
    })
  return extension
}

export const rawHtml = (['inline', 'block'] as const).map((level) => {
  const name = level === 'inline' ? 'rawHtmlInline' : 'rawHtmlBlock'
  return Node.create({
    name,
    group: level,
    inline: level === 'inline',
    atom: true,
    selectable: true,
    marks: '',
    addAttributes: () => ({ source: { default: '', rendered: false } }),
    parseHTML: () => [
      {
        tag: `[data-raw-html="${level}"]`,
        priority: 100,
        getAttrs: (element) =>
          element.getAttribute('data-raw-html-session') === clipboardSession
            ? { source: element.textContent ?? '' }
            : false,
      },
    ],
    renderHTML: ({ node }) => [
      level === 'block' ? 'pre' : 'span',
      {
        'data-raw-html': level,
        class: `hibi-literal-${level}`,
        contenteditable: 'false',
      },
      ['code', {}, node.attrs.source],
    ],
    renderText: ({ node }) => node.attrs.source,
    addProseMirrorPlugins() {
      if (level !== 'inline') return []
      const serializer = DOMSerializer.fromSchema(this.editor.schema)
      const clipboardSerializer = new DOMSerializer(
        serializer.nodes,
        serializer.marks,
      )
      clipboardSerializer.serializeFragment = (...args) => {
        const fragment = serializer.serializeFragment(...args)
        for (const element of fragment.querySelectorAll('[data-raw-html]'))
          element.setAttribute('data-raw-html-session', clipboardSession)
        return fragment
      }
      return [new Plugin({ props: { clipboardSerializer } })]
    },
    markdownTokenName: level === 'block' ? 'html' : name,
    parseMarkdown: (token, helpers) => {
      const source =
        level === 'block'
          ? (token.raw ?? '').replace(/\n+$/, '')
          : (token.raw ?? '')
      if (
        level === 'inline' &&
        /^<br\s*\/?>$/i.test(source) &&
        markdownSyntax.enabled('core.line-breaks')
      )
        return helpers.createNode('hardBreak', { rawHtml: source })
      return helpers.createNode(name, { source })
    },
    renderMarkdown: (node) => node.attrs?.source ?? '',
  })
})
