import { Marked } from 'marked'
import type { RenderedMarkdown } from '../../addons/api'
import { blockMarkdown } from '../../shared/marked-blocks.ts'
import literalStyles from '../../ui/markdown-literal.css?raw'
import syntaxStyles from '../../ui/syntax.css?raw'
import { codeHtml, escapeCode } from './code-languages'
import { flavorMatches, flavors, loadFlavor, selectedFlavors } from './flavors'
import { markdownSyntax } from './markdown-syntax'
import { installSyntaxPreferences } from './syntax-parser'

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
  if (literalHtml)
    parser.use({
      walkTokens(token) {
        // Text inside inline `<pre>`, `<code>`, `<kbd>` and `<script>` is
        // passed through as markup too. A `<br>` the formatted view draws as
        // a line break stays one.
        const block = token.type === 'html' && token.block
        if (
          token.type === 'html'
            ? block ||
              !/^<br\s*\/?>$/i.test(token.raw) ||
              !markdownSyntax.enabled('core.line-breaks')
            : token.type === 'text' && token.escaped
        )
          Object.assign(token, {
            type: block ? 'hibiLiteralBlock' : 'hibiLiteralInline',
            text: block ? token.raw.replace(/\n+$/, '') : token.raw,
          })
      },
    })
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
