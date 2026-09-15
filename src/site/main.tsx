import DOMPurify from 'dompurify'
import { FileText, Folder, PanelLeft, Search } from 'lucide-react'
import { marked } from 'marked'
import MiniSearch from 'minisearch'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CommandPalette,
  type PaletteCommand,
} from '../renderer/src/CommandPalette'
import type { WorkspaceSnapshot } from '../shared/workspace'
import { Sidebar, type SidebarItem } from '../ui/Sidebar'
import { useSidebarResize } from '../ui/useSidebarResize'
import './site.css'

const workspace = JSON.parse(
  document.getElementById('workspace-data')?.textContent ?? '{}',
) as WorkspaceSnapshot
const pages = workspace.pages.map((page) => {
  const heading = marked
    .lexer(page.markdown)
    .find((token) => token.type === 'heading')
  return {
    ...page,
    id: page.path,
    title:
      heading?.type === 'heading'
        ? heading.text.replace(/[*`]/g, '')
        : (page.path
            .split('/')
            .at(-1)
            ?.replace(/\.(md|markdown)$/i, '') ?? page.path),
  }
})
const home =
  pages.find((page) => /^(readme|index)\.md$/i.test(page.path)) ?? pages[0]
const byPath = new Map(pages.map((page) => [page.path, page]))
const index = new MiniSearch({
  fields: ['title', 'path', 'markdown'],
  storeFields: ['path', 'title'],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 4, path: 2 },
    combineWith: 'AND',
  },
})
index.addAll(pages)
const navigation: SidebarItem[] = []
for (const page of pages) {
  const parts = page.path.split('/')
  let siblings = navigation
  for (let depth = 0; depth < parts.length; depth++) {
    const name = parts[depth] ?? ''
    const path = parts.slice(0, depth + 1).join('/')
    if (depth === parts.length - 1)
      siblings.push({ id: path, label: page.title, icon: FileText })
    else {
      let folder = siblings.find((item) => item.id === path)
      if (!folder) {
        folder = { id: path, label: name, icon: Folder, children: [] }
        siblings.push(folder)
      }
      siblings = folder.children ?? []
    }
  }
}

function route() {
  const params = new URLSearchParams(location.hash.slice(1))
  return {
    path: params.get('page') ?? home?.path ?? '',
    anchor: params.get('anchor') ?? '',
  }
}
function destination(path: string, anchor = '') {
  return `#${new URLSearchParams({ page: path, ...(anchor ? { anchor } : {}) })}`
}
function navigate(path: string, anchor = '') {
  location.hash = destination(path, anchor)
}

function renderMarkdown(path: string, markdown: string) {
  const fragment = DOMPurify.sanitize(
    marked.parse(markdown, { async: false }),
    {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'strong',
        'em',
        'del',
        's',
        'blockquote',
        'pre',
        'code',
        'ul',
        'ol',
        'li',
        'a',
        'img',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'hr',
        'br',
        'details',
        'summary',
        'input',
      ],
      ALLOWED_ATTR: [
        'href',
        'title',
        'src',
        'alt',
        'colspan',
        'rowspan',
        'align',
        'checked',
        'disabled',
        'type',
      ],
    },
  )
  const slugs = new Map<string, number>()
  for (const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const slug = (heading.textContent ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
    const count = slugs.get(slug) ?? 0
    slugs.set(slug, count + 1)
    heading.id = `doc-${slug}${count ? `-${count}` : ''}`
  }
  for (const input of fragment.querySelectorAll('input')) input.disabled = true
  for (const image of fragment.querySelectorAll('img')) {
    if (
      !/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(
        image.getAttribute('src') ?? '',
      )
    )
      image.removeAttribute('src')
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href')
    if (!href) continue
    try {
      const url = new URL(href, `https://hibi.invalid/${path}`)
      if (url.origin !== 'https://hibi.invalid') {
        if (!['https:', 'http:', 'mailto:'].includes(url.protocol))
          link.removeAttribute('href')
        else {
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
        }
        continue
      }
      const relative = decodeURIComponent(url.pathname.slice(1))
      const target = [
        relative,
        `${relative.replace(/\/$/, '')}/README.md`,
        `${relative.replace(/\/$/, '')}/index.md`,
      ].find((candidate) => byPath.has(candidate))
      if (target)
        link.href = destination(target, decodeURIComponent(url.hash.slice(1)))
      else {
        link.removeAttribute('href')
        link.title = 'this file is not included in the export'
      }
    } catch {
      link.removeAttribute('href')
    }
  }
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

function DocumentationSite() {
  const [current, setCurrent] = useState(route)
  const [palette, setPalette] = useState(false)
  const [sidebar, setSidebar] = useState(() => innerWidth > 700)
  const sidebarResize = useSidebarResize(240)
  const page = byPath.get(current.path)
  const html = useMemo(
    () => (page ? renderMarkdown(page.path, page.markdown) : ''),
    [page],
  )
  useEffect(() => {
    const update = () => setCurrent(route())
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('hashchange', update)
    window.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('keydown', keyboard)
    }
  }, [])
  useEffect(() => {
    document.title = `${page?.title ?? 'page not found'} · ${workspace.name}`
    if (current.anchor)
      document.getElementById(`doc-${current.anchor}`)?.scrollIntoView()
    else document.querySelector('.site-content')?.scrollTo(0, 0)
  }, [page, current.anchor])
  const command = (path: string): PaletteCommand => ({
    id: path,
    label: byPath.get(path)?.title ?? path,
    category: 'documents',
    run: () => {
      navigate(path)
      if (innerWidth <= 700) setSidebar(false)
    },
  })
  return (
    <div
      className="documentation-site"
      data-sidebar={sidebar}
      style={{ '--sidebar-width': `${sidebarResize.width}px` } as CSSProperties}
    >
      <header className="site-header">
        <button
          type="button"
          aria-label="toggle navigation"
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          <PanelLeft size={18} />
        </button>
        <span>{workspace.name}</span>
        <button
          type="button"
          className="site-search"
          onClick={() => setPalette(true)}
          aria-label="search documentation"
        >
          <Search size={15} />
          <span>search documentation</span>
          <kbd>{/Mac/.test(navigator.platform) ? '⌘' : 'ctrl+'}k</kbd>
        </button>
      </header>
      <div className="site-layout">
        <Sidebar
          resize={sidebarResize}
          open={sidebar}
          items={navigation}
          selected={current.path}
          onSelect={(path) => {
            navigate(path)
            if (innerWidth <= 700) setSidebar(false)
          }}
          label="documentation navigation"
          header={<span>documentation</span>}
        />
        <main className="site-content" aria-label="documentation">
          {page ? (
            <>
              <div className="site-path">{page.path}</div>
              <article
                className="tiptap"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: strict DOMPurify allowlist sanitizes this markdown before rendering.
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          ) : (
            <div className="site-missing">
              <h1>page not found</h1>
              <button type="button" onClick={() => setPalette(true)}>
                search documentation
              </button>
            </div>
          )}
        </main>
      </div>
      {palette && (
        <CommandPalette
          commands={pages.map((page) => command(page.path))}
          platform={/Mac/.test(navigator.platform) ? 'darwin' : 'linux'}
          searchCommands={(query) =>
            query.trim()
              ? index
                  .search(query)
                  .slice(0, 50)
                  .map((result) => command(String(result.id)))
              : pages.slice(0, 50).map((page) => command(page.path))
          }
          onClose={() => setPalette(false)}
        />
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<DocumentationSite />)
