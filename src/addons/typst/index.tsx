import { isMarkdownDocument } from '../../shared/document-types'
import { formatToolbar } from '../_shared/format-toolbar'
import { type DocumentFormat, defineAddon } from '../api'
import { typstNode } from './Block'
import { typstLanguage } from './language'
import manifest from './manifest'
import { TypstPreview } from './Preview'
import css from './style.css?inline'
import { svgSource, typstFlavor, typstTokens } from './syntax'
import type { TypstResult } from './types'

export default defineAddon({
  manifest,
  flavors: [typstFlavor],
  start(context) {
    context.editor.registerSyntax({
      id: 'blocks',
      label: 'Typst blocks',
      group: 'typst',
      description: 'Render fenced Typst inside Markdown.',
      level: 'block',
      extensions: ['typstBlock'],
      matches: (token) =>
        token.type === 'typstBlock' ||
        (token.type === 'code' && /^typst(?:\s|$)/i.test(token.lang ?? '')),
    })
    context.styles.register('preview', css)
    context.editor.registerCodeLanguage({
      id: 'typst',
      aliases: ['typ'],
      language: typstLanguage,
    })
    async function render(source: string, documentId?: string, block = false) {
      const result = await context.native.query<TypstResult>('compile', {
        source,
        documentId,
        block,
      })
      if (!result.svg)
        throw new Error(
          result.diagnostics.map((error) => error.message).join('\n'),
        )
      return `<figure class="typst-preview"><img src="${svgSource(result.svg)}" alt="typst ${block ? 'block' : 'document'} preview"></figure>`
    }
    const format: DocumentFormat = {
      id: 'typst',
      name: 'typst',
      extensions: ['typ'],
      language: typstLanguage,
      codeLanguage: 'typst',
      views: ['side-by-side', 'markdown'],
      formatting: formatToolbar('typst'),
      Preview: ({ value, document, toolbar }) => (
        <TypstPreview
          value={value}
          documentId={document.id}
          context={context}
          toolbar={toolbar}
          onExport={exportPdf}
        />
      ),
      render: async (source, id) => ({ html: await render(source, id), css }),
      insertMedia: (items) =>
        items
          .map(({ url, alt }) =>
            /\.(mp4|webm|ogg)$/i.test(url)
              ? `#link(${JSON.stringify(decodeURIComponent(url))})[${alt.replace(/[[\]#]/g, '')}]`
              : `#image(${JSON.stringify(decodeURIComponent(url))})`,
          )
          .join('\n\n'),
    }
    context.editor.registerDocumentFormat(format)
    context.editor.registerFlavor({
      ...typstFlavor,
      richExtensions: [typstNode(context)],
      export: {
        extensions: [
          typstTokens,
          {
            extensions: [
              {
                name: 'typstBlock',
                renderer: (token) =>
                  `<pre data-typst="${encodeURIComponent(String(token.source))}"></pre>`,
              },
            ],
          },
        ],
        css,
        async transform(rendered, _source, documentId) {
          const document = new DOMParser().parseFromString(
            rendered.html,
            'text/html',
          )
          for (const block of document.querySelectorAll('[data-typst]'))
            block.outerHTML = await render(
              decodeURIComponent(block.getAttribute('data-typst') ?? ''),
              documentId,
              true,
            )
          return { ...rendered, html: document.body.innerHTML }
        },
      },
    })
    context.commands.register({
      id: 'new',
      label: 'New Typst document',
      run: async () => {
        if (await context.native.invoke('create'))
          context.app.runAction('side-by-side')
      },
    })
    async function exportPdf() {
      const document = context.editor.getDocument()
      if (!document?.name.toLowerCase().endsWith('.typ')) {
        await context.dialogs.alert({
          title: 'Open a Typst document',
          description:
            'open a .typ file, or use the pdf button on a typst block.',
        })
        return
      }
      const path = await context.native.invoke<string | null>('pdf', {
        source: document.markdown,
        documentId: document.id,
      })
      if (path) context.notify(`exported pdf to ${path}`)
    }
    context.commands.register({
      id: 'pdf',
      label: 'Export Typst PDF',
      run: exportPdf,
    })
    context.commands.register({
      id: 'block',
      label: 'Insert Typst block',
      slash: {
        label: 'Typst',
        description: 'Rendered Typst block',
        transform: (source) =>
          `${source}\n\n\`\`\`typst\n$ sum_(k=1)^n k = (n(n+1))/2 $\n\`\`\`\n`,
      },
      run: async () => {
        const document = context.editor.getDocument()
        if (!document || !isMarkdownDocument(document.name)) {
          await context.dialogs.alert({
            title: 'Open a Markdown document',
            description:
              'Typst blocks belong inside Markdown. write Typst directly in .typ files.',
          })
          return
        }
        await context.editor.updateMarkdown(
          (source) => `${source}\n\n\`\`\`typst\n$ x^2 $\n\`\`\`\n`,
        )
      },
    })
  },
})
