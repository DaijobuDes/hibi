import type { Token } from 'marked'

/** One renderable Markdown feature, exposed in settings → syntax. */
export type MarkdownSyntaxFeature = {
  id: string
  label: string
  group: string
  description?: string
  level: 'block' | 'inline'
  /** Match lexer tokens, including the token emitted by the export parser. */
  matches: (token: Readonly<Token>) => boolean
  /** Rich extension names to disable with this feature; keep export tokenizers registered. */
  extensions?: readonly string[]
}
