import {
  type AnyExtension,
  getExtensionField,
  type JSONContent,
  Node,
} from '@tiptap/core'
import { DOMParser } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import type { Token } from 'marked'
import { markdownSyntax } from './markdown-syntax.ts'

let lastCopiedHtml = ''
const trustedClipboardElements = new WeakSet<Element>()
const clipboardHtml = (html: string) =>
  html.replace(/^<meta charset=['"]utf-8['"]>/i, '')
const htmlBreak = /^<br\s*\/?>$/i

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
      addAttributes: () => ({
        rawHtml: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const source = element.getAttribute('data-raw-html-break')
            return trustedClipboardElements.has(element) &&
              source &&
              htmlBreak.test(source)
              ? source
              : null
          },
          renderHTML: (attrs: { rawHtml: string | null }) =>
            attrs.rawHtml ? { 'data-raw-html-break': attrs.rawHtml } : {},
        },
      }),
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
          trustedClipboardElements.has(element)
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
      let internalPaste = false
      const parser = DOMParser.fromSchema(this.editor.schema)
      const clipboardParser = new DOMParser(parser.schema, parser.rules)
      clipboardParser.parseSlice = (dom, options) => {
        if (internalPaste)
          for (const element of (dom as HTMLElement).querySelectorAll(
            '[data-raw-html], [data-raw-html-break]',
          ))
            trustedClipboardElements.add(element)
        internalPaste = false
        return parser.parseSlice(dom, options)
      }
      return [
        new Plugin({
          props: {
            clipboardParser,
            transformPastedHTML(html) {
              internalPaste =
                !!lastCopiedHtml && clipboardHtml(html) === lastCopiedHtml
              return html
            },
          },
          view(view) {
            // Read the final payload after ProseMirror's copy/cut/drag handler.
            const remember = (event: Event) => {
              if (!view.dom.contains(event.target as globalThis.Node)) return
              const data =
                (event as ClipboardEvent).clipboardData ??
                (event as DragEvent).dataTransfer
              if (data)
                lastCopiedHtml = clipboardHtml(data.getData('text/html'))
            }
            const events = ['copy', 'cut', 'dragstart']
            const document = view.dom.ownerDocument
            for (const event of events)
              document.addEventListener(event, remember)
            return {
              destroy() {
                for (const event of events)
                  document.removeEventListener(event, remember)
              },
            }
          },
        }),
      ]
    },
    markdownTokenName: level === 'block' ? 'html' : name,
    parseMarkdown: (token, helpers) => {
      const source =
        level === 'block'
          ? (token.raw ?? '').replace(/\n+$/, '')
          : (token.raw ?? '')
      if (
        level === 'inline' &&
        htmlBreak.test(source) &&
        markdownSyntax.enabled('core.line-breaks')
      )
        return helpers.createNode('hardBreak', { rawHtml: source })
      return helpers.createNode(name, { source })
    },
    renderMarkdown: (node) => node.attrs?.source ?? '',
  })
})
