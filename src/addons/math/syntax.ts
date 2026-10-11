import { Marked, type MarkedExtension } from 'marked'
import type { MarkdownFlavor } from '../api'

export function inlineMath(source: string) {
  const match = /^\$(?!\$)((?:\\.|[^$\n])+?)\$(?!\$)/.exec(source)
  const latex = match?.[1]
  if (!match || !latex || latex.length > 10000 || latex.trim() !== latex) return
  return { type: 'inlineMath', raw: match[0], latex }
}
export function blockMathStart(source: string) {
  // Marked probes after dropping the first character; only a real newline
  // proves a block boundary. The tokenizer handles the current line itself.
  const match = /\n {0,3}\$\$/.exec(source)
  return match ? match.index + 1 : -1
}
export function blockMath(source: string) {
  const match =
    /^ {0,3}\$\$[ \t]*\n?((?:\\[\s\S]|(?!\$\$)[^\\])+?)\$\$(?:[ \t]*(?:\n|$))/.exec(
      source,
    )
  if (!match?.[1]?.trim() || match[1].length > 10000) return
  return { type: 'blockMath', raw: match[0], latex: match[1].trim() }
}
export const mathTokens: MarkedExtension = {
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: blockMathStart,
      tokenizer: blockMath,
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (source) => source.indexOf('$'),
      tokenizer: inlineMath,
    },
  ],
}
const detector = new Marked(mathTokens)
export const mathFlavor: MarkdownFlavor = {
  id: 'latex',
  name: 'Math',
  kind: 'syntax',
  description: 'LaTeX math: $…$ within a line or $$…$$ in a separate block.',
  detect(source) {
    if (!source.includes('$')) return false
    let found = false
    detector.walkTokens(detector.lexer(source), (token) => {
      if (token.type === 'inlineMath' || token.type === 'blockMath')
        found = true
      return []
    })
    return found
  },
}
