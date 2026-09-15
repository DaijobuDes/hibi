import type { MarkdownProjection } from '../api'

export function splitFrontmatter(source: string) {
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
    opening: opening[0],
    yaml: source.slice(opening[0].length, opening[0].length + closing.index),
    closing: closing[0] + spacing,
    eol: opening[1] as string,
    prefix,
    content: source.slice(prefix.length),
  }
}

export function replaceFrontmatter(source: string, yaml: string): string {
  const block = splitFrontmatter(source)
  if (!block) return source
  const normalized = yaml.replace(/\r\n|\r|\n/g, block.eol)
  return (
    block.opening +
    normalized +
    (normalized && !normalized.endsWith(block.eol) ? block.eol : '') +
    block.closing +
    block.content
  )
}

export function parseFrontmatter(source: string): MarkdownProjection | null {
  const block = splitFrontmatter(source)
  if (!block) return null
  return {
    content: block.content,
    serialize: (content) =>
      block.prefix +
      (content && !block.prefix.endsWith('\n') ? block.eol : '') +
      content,
  }
}
