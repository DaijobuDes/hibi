import type { MarkdownProjection } from '../api'

export function parseFrontmatter(source: string): MarkdownProjection | null {
  const opening = /^(?:\uFEFF)?---[ \t]*(\r?\n)/.exec(source)
  if (!opening) return null
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(
    source.slice(opening[0].length),
  )
  if (!closing) return null
  const end = opening[0].length + closing.index + closing[0].length
  const spacing = /^(?:[ \t]*\r?\n)*/.exec(source.slice(end))?.[0] ?? ''
  const prefix = source.slice(0, end + spacing.length)
  return {
    content: source.slice(prefix.length),
    serialize: (content) =>
      prefix + (content && !prefix.endsWith('\n') ? opening[1] : '') + content,
  }
}
