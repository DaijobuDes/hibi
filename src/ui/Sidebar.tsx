/** biome-ignore-all lint/a11y/useAriaPropsSupportedByRole: both conditional tree/tab roles support the corresponding ARIA attributes. */
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import './sidebar.css'

export type SidebarItem = {
  id: string
  label: string
  icon?: LucideIcon
  children?: SidebarItem[]
}
export type SidebarProps = {
  items: readonly SidebarItem[]
  selected: string | null
  onSelect: (id: string) => void
  label: string
  mode?: 'tree' | 'tabs'
  className?: string
  idPrefix?: string
  panelPrefix?: string
  header?: ReactNode
  footer?: ReactNode
  empty?: ReactNode
}

export function Sidebar({
  items,
  selected,
  onSelect,
  label,
  mode = 'tree',
  className = '',
  idPrefix = 'sidebar',
  panelPrefix = '',
  header,
  footer,
  empty,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (mode === 'tabs') return
    const parents: string[] = []
    function find(items: readonly SidebarItem[]): boolean {
      return items.some((item) => {
        if (item.id === selected) return true
        if (item.children && find(item.children)) {
          parents.push(item.id)
          return true
        }
        return false
      })
    }
    if (selected && find(items))
      setExpanded((old) => new Set([...old, ...parents]))
  }, [items, selected, mode])
  const rows = useMemo(() => {
    const visible: {
      item: SidebarItem
      depth: number
      parent: string | null
      position: number
      size: number
    }[] = []
    function visit(
      items: readonly SidebarItem[],
      depth: number,
      parent: string | null,
    ) {
      items.forEach((item, index) => {
        visible.push({
          item,
          depth,
          parent,
          position: index + 1,
          size: items.length,
        })
        if (item.children && expanded.has(item.id))
          visit(item.children, depth + 1, item.id)
      })
    }
    visit(items, 0, null)
    return visible
  }, [items, expanded])
  const active = rows.findIndex(({ item }) => item.id === selected)
  const focusId = rows.some(({ item }) => item.id === focused)
    ? focused
    : (rows[active]?.item.id ?? rows[0]?.item.id)
  const toggle = (id: string) =>
    setExpanded((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  function focus(id: string | undefined) {
    if (!id) return
    setFocused(id)
    buttons.current.get(id)?.focus()
    if (mode === 'tabs') onSelect(id)
  }
  return (
    <aside className={`sidebar ${className}`} aria-label={label}>
      {header && <div className="sidebar-header">{header}</div>}
      <div className="sidebar-scroll">
        <div
          className="sidebar-items"
          role={mode === 'tabs' ? 'tablist' : 'tree'}
          aria-label={label}
          aria-orientation={mode === 'tabs' ? 'vertical' : undefined}
        >
          {active >= 0 && (
            <span
              className="sidebar-selection category-selection"
              aria-hidden="true"
              style={{ transform: `translateY(${active * 28}px)` }}
            />
          )}
          {rows.map(({ item, depth, parent, position, size }, index) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) buttons.current.set(item.id, element)
                  else buttons.current.delete(item.id)
                }}
                id={`${idPrefix}-${item.id}`}
                type="button"
                role={mode === 'tabs' ? 'tab' : 'treeitem'}
                aria-selected={selected === item.id}
                aria-expanded={
                  item.children ? expanded.has(item.id) : undefined
                }
                aria-level={mode === 'tree' ? depth + 1 : undefined}
                aria-posinset={mode === 'tree' ? position : undefined}
                aria-setsize={mode === 'tree' ? size : undefined}
                aria-controls={
                  mode === 'tabs' ? `${panelPrefix}${item.id}` : undefined
                }
                tabIndex={focusId === item.id ? 0 : -1}
                style={{ paddingLeft: 16 + depth * 14 }}
                title={item.label}
                onFocus={() => setFocused(item.id)}
                onClick={() => {
                  if (item.children) toggle(item.id)
                  else onSelect(item.id)
                }}
                onKeyDown={(event) => {
                  switch (event.key) {
                    case 'ArrowDown':
                      event.preventDefault()
                      focus(rows[Math.min(index + 1, rows.length - 1)]?.item.id)
                      break
                    case 'ArrowUp':
                      event.preventDefault()
                      focus(rows[Math.max(index - 1, 0)]?.item.id)
                      break
                    case 'Home':
                      event.preventDefault()
                      focus(rows[0]?.item.id)
                      break
                    case 'End':
                      event.preventDefault()
                      focus(rows.at(-1)?.item.id)
                      break
                    case 'ArrowRight':
                      if (item.children) {
                        event.preventDefault()
                        if (!expanded.has(item.id)) toggle(item.id)
                        else focus(item.children[0]?.id)
                      }
                      break
                    case 'ArrowLeft':
                      event.preventDefault()
                      if (item.children && expanded.has(item.id))
                        toggle(item.id)
                      else if (parent) focus(parent)
                      break
                  }
                }}
              >
                {mode === 'tree' && (
                  <ChevronRight
                    className={`sidebar-chevron ${item.children ? '' : 'leaf'}`}
                    size={12}
                    style={{
                      rotate:
                        item.children && expanded.has(item.id)
                          ? '90deg'
                          : '0deg',
                    }}
                    aria-hidden="true"
                  />
                )}
                {Icon && (
                  <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                )}
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
        {!rows.length && empty && <div className="sidebar-empty">{empty}</div>}
      </div>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </aside>
  )
}
