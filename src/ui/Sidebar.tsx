/** biome-ignore-all lint/a11y/useAriaPropsSupportedByRole: both conditional tree/tab roles support the corresponding ARIA attributes. */
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import './sidebar.css'
import { MIN_SIDEBAR_WIDTH } from './useSidebarResize'

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
  open?: boolean
  className?: string
  idPrefix?: string
  panelPrefix?: string
  header?: ReactNode
  footer?: ReactNode
  empty?: ReactNode
  resize?: {
    width: number
    maxWidth: number
    onChange: (width: number) => void
    onReset: () => void
  }
}

export function Sidebar({
  items,
  selected,
  onSelect,
  label,
  mode = 'tree',
  open = true,
  className = '',
  idPrefix = 'sidebar',
  panelPrefix = '',
  header,
  footer,
  empty,
  resize,
}: SidebarProps) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(
    null,
  )
  const [dragging, setDragging] = useState(false)
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
    <div
      className={`sidebar-slot ${className}`}
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <aside className="sidebar" aria-label={label}>
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
                style={{
                  transform: `translateY(calc(${active} * var(--sidebar-row-height)))`,
                }}
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
                        focus(
                          rows[Math.min(index + 1, rows.length - 1)]?.item.id,
                        )
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
          {!rows.length && empty && (
            <div className="sidebar-empty">{empty}</div>
          )}
        </div>
        {footer && <div className="sidebar-footer">{footer}</div>}
        {resize && (
          <hr
            className="sidebar-resizer"
            data-dragging={dragging}
            aria-label="resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={resize.maxWidth}
            aria-valuenow={resize.width}
            tabIndex={0}
            title="drag to resize; double-click to reset"
            onDoubleClick={resize.onReset}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                x: event.clientX,
                width: resize.width,
                pointer: event.pointerId,
              }
              setDragging(true)
            }}
            onPointerMove={(event) => {
              if (drag.current?.pointer === event.pointerId)
                resize.onChange(
                  drag.current.width + event.clientX - drag.current.x,
                )
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              if (drag.current) resize.onChange(drag.current.width)
            }}
            onLostPointerCapture={() => {
              drag.current = null
              setDragging(false)
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 24 : 8
              switch (event.key) {
                case 'ArrowLeft':
                  resize.onChange(resize.width - step)
                  break
                case 'ArrowRight':
                  resize.onChange(resize.width + step)
                  break
                case 'Home':
                  resize.onChange(MIN_SIDEBAR_WIDTH)
                  break
                case 'End':
                  resize.onChange(resize.maxWidth)
                  break
                case 'Enter':
                  resize.onReset()
                  break
                case 'Escape':
                  if (!drag.current) return
                  resize.onChange(drag.current.width)
                  event.currentTarget.releasePointerCapture(
                    drag.current.pointer,
                  )
                  break
                default:
                  return
              }
              event.preventDefault()
              event.stopPropagation()
            }}
          />
        )}
      </aside>
    </div>
  )
}
