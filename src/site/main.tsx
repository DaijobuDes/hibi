import DOMPurify from 'dompurify'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  PanelLeft,
  Search,
} from 'lucide-react'
import { marked } from 'marked'
import MiniSearch from 'minisearch'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CommandPalette,
  type PaletteCommand,
} from '../renderer/src/CommandPalette'
import type { WorkspaceSnapshot } from '../shared/workspace'
import { IconButton } from '../ui/Controls'
import { ShortcutKeys } from '../ui/ShortcutKeys'
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
  const outline: { id: string; label: string; depth: number }[] = []
  for (const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const slug = (heading.textContent ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
    const count = slugs.get(slug) ?? 0
    slugs.set(slug, count + 1)
    heading.id = `doc-${slug}${count ? `-${count}` : ''}`
    if (heading.tagName !== 'H1' && heading.textContent?.trim())
      outline.push({
        id: heading.id,
        label: heading.textContent.trim(),
        depth: Number(heading.tagName.slice(1)),
      })
  }
  for (const table of fragment.querySelectorAll('table')) {
    const scroll = document.createElement('div')
    scroll.className = 'site-table-scroll'
    scroll.tabIndex = 0
    scroll.setAttribute('role', 'region')
    scroll.setAttribute('aria-label', 'table')
    table.replaceWith(scroll)
    scroll.append(table)
  }
  for (const input of fragment.querySelectorAll('input')) input.disabled = true
  for (const image of fragment.querySelectorAll('img')) {
    const embedded = byPath.get(path)?.images?.[image.getAttribute('src') ?? '']
    if (typeof embedded === 'string') image.setAttribute('src', embedded)
    if (
      !/^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,/i.test(
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
  return { html: container.innerHTML, outline }
}

function DocumentationSite() {
  const [current, setCurrent] = useState(route)
  const [palette, setPalette] = useState(false)
  const [sidebar, setSidebar] = useState(() => innerWidth > 700)
  const [mobile, setMobile] = useState(() => innerWidth <= 700)
  const [activeHeading, setActiveHeading] = useState('')
  const sidebarResize = useSidebarResize(240)
  const page = byPath.get(current.path)
  const { html, outline } = useMemo(
    () =>
      page
        ? renderMarkdown(page.path, page.markdown)
        : { html: '', outline: [] },
    [page],
  )
  useEffect(() => {
    const media = matchMedia('(max-width: 700px)')
    const resized = () => {
      setMobile(media.matches)
      if (media.matches) setSidebar(false)
    }
    media.addEventListener('change', resized)
    const update = () => {
      setCurrent(route())
      if (media.matches) setSidebar(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
      }
      if (
        event.key === 'Escape' &&
        !document.querySelector('dialog[open]') &&
        media.matches
      )
        setSidebar(false)
    }
    window.addEventListener('hashchange', update)
    window.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('keydown', keyboard)
      media.removeEventListener('change', resized)
    }
  }, [])
  useEffect(() => {
    document.title = `${page?.title ?? 'page not found'} · ${workspace.name}`
    if (current.anchor)
      document.getElementById(`doc-${current.anchor}`)?.scrollIntoView()
    else document.querySelector('.site-content')?.scrollTo(0, 0)
  }, [page, current.anchor])
  useEffect(() => {
    const scroller = document.querySelector('.site-content')
    const headings = outline
      .map(({ id }) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node))
    let frame = 0
    const update = () => {
      frame = 0
      const edge = (scroller?.getBoundingClientRect().top ?? 0) + 48
      let active = headings[0]?.id ?? ''
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > edge) break
        active = heading.id
      }
      setActiveHeading(active)
    }
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    scroller?.addEventListener('scroll', scroll, { passive: true })
    return () => {
      scroller?.removeEventListener('scroll', scroll)
      cancelAnimationFrame(frame)
    }
  }, [outline])
  const pageIndex = pages.findIndex((entry) => entry.path === current.path)
  const previous = pages[pageIndex - 1]
  const next = pageIndex >= 0 ? pages[pageIndex + 1] : undefined
  const folders = current.path.split('/').slice(0, -1)
  const outlineLinks = (
    <nav aria-label="in this page">
      {outline.map((heading) => (
        <a
          key={heading.id}
          href={destination(current.path, heading.id.slice(4))}
          aria-current={activeHeading === heading.id ? 'location' : undefined}
          style={
            {
              '--heading-indent': `${Math.max(0, heading.depth - 2) * 12}px`,
            } as CSSProperties
          }
          onClick={(event) => {
            const details = event.currentTarget.closest('details')
            if (details) details.open = false
            document.getElementById(heading.id)?.scrollIntoView()
          }}
        >
          {heading.label}
        </a>
      ))}
    </nav>
  )
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
        <div className="site-navigation-controls">
          <IconButton
            type="button"
            aria-label="toggle navigation"
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeft size={18} />
          </IconButton>
        </div>
        <div className="site-header-content">
          <nav
            className="site-breadcrumbs"
            aria-label="breadcrumbs"
            aria-hidden={mobile && sidebar}
          >
            <ol>
              <li>
                <a href={destination(home?.path ?? '')}>
                  <Folder aria-hidden="true" />
                  <span>{workspace.name}</span>
                </a>
              </li>
              {folders.map((folder, index) => {
                const prefix = folders.slice(0, index + 1).join('/')
                const target =
                  [`${prefix}/README.md`, `${prefix}/index.md`].find((path) =>
                    byPath.has(path),
                  ) ??
                  pages.find((entry) => entry.path.startsWith(`${prefix}/`))
                    ?.path
                return (
                  <li key={prefix}>
                    <ChevronRight aria-hidden="true" />
                    {target ? (
                      <a href={destination(target)}>{folder}</a>
                    ) : (
                      <span>{folder}</span>
                    )}
                  </li>
                )
              })}
              <li aria-current="page">
                <ChevronRight aria-hidden="true" />
                <span>{page?.title ?? 'page not found'}</span>
              </li>
            </ol>
          </nav>
          <button
            type="button"
            className="site-search"
            onClick={() => setPalette(true)}
            aria-label="search documentation"
          >
            <Search size={15} />
            <span className="site-search-label">search documentation</span>
            <ShortcutKeys
              shortcut={/Mac/.test(navigator.platform) ? 'meta+k' : 'ctrl+k'}
              platform={/Mac/.test(navigator.platform) ? 'darwin' : 'linux'}
            />
          </button>
        </div>
      </header>
      <div className="site-layout">
        <button
          type="button"
          className="site-nav-scrim"
          aria-label="close navigation"
          aria-hidden={!mobile || !sidebar}
          tabIndex={mobile && sidebar ? 0 : -1}
          onClick={() => setSidebar(false)}
        />
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
        <main
          className="site-content"
          aria-label="documentation"
          inert={mobile && sidebar}
        >
          {page ? (
            <div className="site-document-layout">
              <div className="site-reading">
                {outline.length > 0 && (
                  <details className="site-outline-mobile">
                    <summary>
                      in this page
                      <ChevronDown size={14} aria-hidden="true" />
                    </summary>
                    {outlineLinks}
                  </details>
                )}
                <article
                  className="tiptap"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: strict DOMPurify allowlist sanitizes this markdown before rendering.
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {(previous || next) && (
                  <nav className="site-pagination" aria-label="page navigation">
                    {previous ? (
                      <a href={destination(previous.path)}>
                        <span>
                          <ArrowLeft size={14} aria-hidden="true" />
                          previous
                        </span>
                        <strong>{previous.title}</strong>
                      </a>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <a className="site-next" href={destination(next.path)}>
                        <span>
                          next
                          <ArrowRight size={14} aria-hidden="true" />
                        </span>
                        <strong>{next.title}</strong>
                      </a>
                    ) : (
                      <span />
                    )}
                  </nav>
                )}
              </div>
              {outline.length > 0 && (
                <aside className="site-outline">
                  <p>in this page</p>
                  {outlineLinks}
                </aside>
              )}
            </div>
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
