import { Marked } from 'marked'
import type { RenderedMarkdown } from '../../addons/api'
import { blockMarkdown } from '../../shared/marked-blocks.ts'
import literalStyles from '../../ui/markdown-literal.css?raw'
import syntaxStyles from '../../ui/syntax.css?raw'
import { codeHtml, escapeCode } from './code-languages'
import { flavorMatches, flavors, loadFlavor, selectedFlavors } from './flavors'
import { markdownSyntax } from './markdown-syntax'
import { installSyntaxPreferences } from './syntax-parser'
import './markdown-detectors.ts'

/**
 * `literalHtml` renders raw HTML as its literal source, as the formatted view
 * shows it, instead of as sanitized markup.
 */
export function renderMarkdown(
  source: string,
  documentId?: string,
  literalHtml = false,
): RenderedMarkdown {
  const selected = selectedFlavors(loadFlavor(documentId), flavors.snapshot())
  const parser = installSyntaxPreferences(
    new Marked({ gfm: false, breaks: false }, blockMarkdown),
  )
  parser.use({
    renderer: {
      code({ text, lang }) {
        const language = lang?.trim().split(/\s+/)[0] ?? ''
        return `<pre><code${language ? ` class="language-${escapeCode(language)}"` : ''}>${codeHtml(text, language)}\n</code></pre>\n`
      },
    },
  })
  for (const flavor of selected) {
    if (flavor.markedOptions) parser.setOptions(flavor.markedOptions)
    for (const extension of flavor.export?.extensions ?? [])
      parser.use(extension)
  }
  if (literalHtml) {
    // Image descriptions stay plain text, as marked renders them.
    const descriptions = new WeakSet<object>()
    parser.use({
      walkTokens(token) {
        if (token.type === 'image' || descriptions.has(token)) {
          if ('tokens' in token)
            for (const child of token.tokens ?? []) descriptions.add(child)
        } else if (token.type === 'html') {
          // A `<br>` the formatted view draws as a line break stays one.
          if (
            !token.block &&
            /^<br\s*\/?>$/i.test(token.raw) &&
            markdownSyntax.enabled('core.line-breaks')
          )
            token.text = '<br>'
          else
            Object.assign(token, {
              type: token.block ? 'hibiLiteralBlock' : 'hibiLiteralInline',
              text: token.block ? token.raw.replace(/\n+$/, '') : token.raw,
            })
        } else if (token.type === 'text' && token.escaped)
          // Marked passes text inside inline `<pre>`, `<code>`, `<kbd>` and
          // `<script>` through as markup.
          Object.assign(token, { type: 'hibiLiteralInline', text: token.raw })
      },
    })
  }
  return {
    html: parser.parse(source, { async: false }),
    css:
      syntaxStyles +
      literalStyles +
      '\n' +
      selected
        .filter(
          (flavor) =>
            flavor.kind === 'dialect' || flavorMatches(flavor, source),
        )
        .map((flavor) => flavor.export?.css ?? '')
        .join('\n'),
  }
}
