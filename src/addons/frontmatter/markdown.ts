import { readFrontmatter as splitFrontmatter } from '../../shared/frontmatter.ts'
import type { MarkdownProjection } from '../api'

export { splitFrontmatter }

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
