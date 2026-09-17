import { Marked } from 'marked'
import { isMarkdownDocument } from '../../shared/document-types.ts'
import { readFrontmatter } from '../../shared/frontmatter.ts'
import type { WorkspacePage } from '../../shared/workspace'

export function localTarget(
  from: string,
  href: string,
  paths: ReadonlySet<string>,
) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return null
  let path: string
  try {
    path = decodeURIComponent(href.split(/[?#]/)[0] ?? '')
  } catch {
    return null
  }
  if (!path || path.includes('\\') || path.includes('\0')) return null
  const parts = path.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  const target = parts.join('/')
  return paths.has(target) ? target : null
}

export function noteGraph(pages: readonly WorkspacePage[]) {
  const paths = new Set(pages.map((page) => page.path))
  const parser = new Marked({ gfm: true })
  const edges = new Map<string, { source: string; target: string }>()
  for (const page of pages) {
    if (!isMarkdownDocument(page.path)) continue
    const source = readFrontmatter(page.markdown)?.content ?? page.markdown
    parser.walkTokens(parser.lexer(source), (token) => {
      if (token.type !== 'link') return
      const target = localTarget(page.path, token.href, paths)
      if (!target || target === page.path) return
      const pair = [page.path, target].sort()
      edges.set(JSON.stringify(pair), { source: pair[0]!, target: pair[1]! })
    })
  }
  const degree = new Map<string, number>()
  for (const edge of edges.values())
    for (const path of [edge.source, edge.target])
      degree.set(path, (degree.get(path) ?? 0) + 1)
  return {
    nodes: pages.map((page) => ({
      id: page.path,
      label: (page.path.split('/').at(-1) ?? page.path).replace(/\.[^.]+$/, ''),
      degree: degree.get(page.path) ?? 0,
    })),
    edges: [...edges.values()],
  }
}
