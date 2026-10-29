import { Strikethrough } from '@lezer/markdown'
import { formattedMarkerRanges } from '../../../shared/formatted-text-rules.ts'
import {
  type FormattedContribution,
  formattedLiteral,
} from '../formatted-contributions.ts'
import { markdownSyntax } from '../markdown-syntax.ts'

/** `~~text~~` strikes through its text and hides the tildes. */
export const contribution: FormattedContribution = {
  id: 'markdown.strikethrough',
  flavor: 'markdown.github',
  syntax: Strikethrough,
  inlineStops: true,
  // Legacy syntax registrations may omit nodes; keep ordinary text literal too.
  get extension() {
    return markdownSyntax.enabled('markdown.strike')
      ? []
      : formattedLiteral.of('Strikethrough')
  },
  views: [
    {
      nodes: ['Strikethrough'],
      decorate(node, out, { state }) {
        if (!state.facet(formattedLiteral).includes('Strikethrough'))
          out.mark(node.from, node.to, { class: 'hibi-lp-strike' })
        for (const range of formattedMarkerRanges(node.node, (a, b) =>
          state.sliceDoc(a, b),
        ))
          out.syntax(range.from, range.to)
        return undefined
      },
    },
  ],
}
