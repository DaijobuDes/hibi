import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Ellipsis,
  GripVertical,
  Puzzle,
} from 'lucide-react'
import {
  type DragEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Button,
  IconButton,
  Select,
  SettingRow,
  Toggle,
} from '../../ui/Controls'
import type { ToolbarItem, ToolbarPreferences } from '../../ui/toolbar'
import type { ViewMode } from './Editor'
import { toolbar } from './toolbar'
import './toolbar.css'

function useReorder(axis: 'x' | 'y') {
  const dragged = useRef('')
  const returnFocus = useRef<HTMLElement | null>(null)
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(
    null,
  )
  const clear = () => {
    dragged.current = ''
    setTarget(null)
    returnFocus.current?.focus()
    returnFocus.current = null
  }
  return {
    target,
    props: (id: string) => ({
      draggable: true,
      onPointerDown() {
        if (axis === 'x')
          returnFocus.current =
            document.activeElement?.closest<HTMLElement>(
              '.cm-content, .tiptap',
            ) ?? null
      },
      onDragStart(event: DragEvent<HTMLElement>) {
        dragged.current = id
        event.dataTransfer.setData('application/x-hibi-toolbar-item', id)
        event.dataTransfer.effectAllowed = 'move'
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!dragged.current) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        const after =
          axis === 'x'
            ? event.clientX > rect.left + rect.width / 2
            : event.clientY > rect.top + rect.height / 2
        setTarget({ id, after })
      },
      onDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault()
        if (dragged.current && target?.id === id)
          toolbar.move(dragged.current, id, target.after)
        clear()
      },
      onDragEnd: clear,
      'data-drop':
        target?.id === id ? (target.after ? 'after' : 'before') : undefined,
    }),
  }
}

export function EditorToolbar({
  mode,
  typing = false,
}: {
  mode: ViewMode
  typing?: boolean
}) {
  const reorder = useReorder('x')
  const row = useRef<HTMLElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [count, setCount] = useState(Infinity)
  const [open, setOpen] = useState(false)
  const { preferences, items } = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.snapshot,
  )
  const visible = items.filter(
    (item) =>
      !item.hidden &&
      (!item.when ||
        (item.when === 'source' ? mode !== 'normal' : mode !== 'markdown')),
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: action and mode changes alter the measured DOM.
  useLayoutEffect(() => {
    const element = row.current,
      measurement = probe.current
    if (!element || !measurement) return
    const measure = () => {
      const style = getComputedStyle(element)
      const gap = Number.parseFloat(style.columnGap) || 0
      const space =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      const widths = Array.from(
        measurement.children,
        (child) => child.getBoundingClientRect().width,
      )
      const overflowWidth = widths.pop() ?? 28
      const total =
        widths.reduce((sum, width) => sum + width, 0) +
        Math.max(0, widths.length - 1) * gap
      let fit = widths.length
      if (total > space) {
        let used = overflowWidth
        fit = 0
        for (const width of widths) {
          if (used + gap + width > space) break
          used += gap + width
          fit++
        }
      }
      setCount(fit)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [items, mode, preferences.mode, preferences.visible])
  const overflow = visible.slice(count)
  const hidden = typing && preferences.autoHide !== false && !open
  const closeMenu = () => {
    menu.current?.hidePopover()
    setOpen(false)
  }
  useLayoutEffect(() => {
    if (!open) return
    if (!overflow.length) {
      menu.current?.hidePopover()
      return
    }
    const popup = menu.current,
      button = more.current
    if (!popup || !button) return
    const rect = button.getBoundingClientRect()
    popup.style.top = `${rect.bottom + 4}px`
    popup.style.left = `${Math.max(8, Math.min(innerWidth - popup.offsetWidth - 8, rect.right - popup.offsetWidth))}px`
    popup.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 12)}px`
    popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open, overflow.length])
  if (!preferences.visible || !visible.length) return null
  return (
    <div
      className="toolbar-slot"
      data-hidden={hidden}
      inert={hidden}
      aria-hidden={hidden}
    >
      <div className="toolbar-clip">
        <nav
          ref={row}
          className="editor-toolbar"
          aria-label="editor toolbar"
          data-mode={preferences.mode}
        >
          {visible.slice(0, count).map((item) => {
            return (
              <Button
                key={item.id}
                data-toolbar-id={item.id}
                {...reorder.props(item.id)}
                aria-label={item.label}
                aria-pressed={item.pressed}
                disabled={item.disabled}
                data-tooltip={item.tooltip ?? item.label}
                onClick={() => void item.onClick()}
              >
                <ActionContent item={item} mode={preferences.mode} />
              </Button>
            )
          })}
          <IconButton
            ref={more}
            className="toolbar-overflow"
            aria-label="more formatting actions"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            hidden={!overflow.length}
            onClick={() => menu.current?.togglePopover()}
          >
            <Ellipsis size={16} aria-hidden />
          </IconButton>
          <div
            ref={menu}
            id={menuId}
            popover="auto"
            role="menu"
            aria-hidden={!open}
            inert={!open}
            aria-label="more formatting actions"
            className="toolbar-menu"
            onToggle={(event) => setOpen(event.newState === 'open')}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ),
                )
                const current = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                )
                const index =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (current +
                          (event.key === 'ArrowDown'
                            ? 1
                            : buttons.length - 1)) %
                        buttons.length
                buttons[index]?.focus()
              } else if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault()
                closeMenu()
                more.current?.focus()
              }
            }}
          >
            {overflow.map((item) => (
              <Button
                key={item.id}
                data-toolbar-id={item.id}
                role={
                  item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'
                }
                aria-checked={item.pressed}
                disabled={item.disabled}
                onClick={() => {
                  closeMenu()
                  void item.onClick()
                }}
              >
                <ActionContent
                  item={item}
                  mode={preferences.mode === 'text' ? 'text' : 'icons-and-text'}
                />
              </Button>
            ))}
          </div>
          <div className="toolbar-measure" ref={probe} aria-hidden inert>
            {visible.map((item) => (
              <span className="ui-button" key={item.id}>
                <ActionContent item={item} mode={preferences.mode} />
              </span>
            ))}
            <span className="toolbar-overflow">
              <Ellipsis size={16} aria-hidden />
            </span>
          </div>
        </nav>
      </div>
    </div>
  )
}

function ActionContent({
  item,
  mode,
}: {
  item: ToolbarItem
  mode: ToolbarPreferences['mode']
}) {
  const Icon = item.icon ?? Puzzle
  return (
    <>
      {mode !== 'text' && <Icon size={16} aria-hidden />}
      {mode !== 'icons' && <span>{item.label}</span>}
    </>
  )
}

export function ToolbarSettings() {
  const reorder = useReorder('y')
  const { preferences, items } = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.snapshot,
  )
  return (
    <>
      <h2>toolbar</h2>
      <div className="settings-group">
        <SettingRow
          id="toolbar-visible"
          label="show toolbar"
          description="show addon actions below the top bar."
        >
          <Toggle
            id="toolbar-visible"
            checked={preferences.visible}
            onChange={(event) =>
              toolbar.setPreferences({ visible: event.target.checked })
            }
          />
        </SettingRow>
        <SettingRow
          id="toolbar-autohide"
          label="hide toolbar while typing"
          description="fade with the top bar and move the page up while you write."
        >
          <Toggle
            id="toolbar-autohide"
            checked={preferences.autoHide !== false}
            onChange={(event) =>
              toolbar.setPreferences({ autoHide: event.target.checked })
            }
          />
        </SettingRow>
        <SettingRow
          id="toolbar-mode"
          label="toolbar labels"
          description="choose how toolbar actions appear."
        >
          <Select
            id="toolbar-mode"
            value={preferences.mode}
            onChange={(event) =>
              toolbar.setPreferences({
                mode: event.target.value as ToolbarPreferences['mode'],
              })
            }
          >
            <option value="icons">icons</option>
            <option value="icons-and-text">icons and text</option>
            <option value="text">text</option>
          </Select>
        </SettingRow>
      </div>
      <details className="toolbar-order">
        <summary>
          <ChevronRight size={14} aria-hidden />
          arrange toolbar actions
        </summary>
        <p>
          drag actions here or on the toolbar. use the arrows to move them with
          a keyboard.
        </p>
        <ol aria-label="toolbar order">
          {items.map((item, index) => {
            const Icon = item.icon ?? Puzzle
            return (
              <li
                key={item.id}
                data-toolbar-id={item.id}
                {...reorder.props(item.id)}
              >
                <GripVertical size={14} aria-hidden className="drag-handle" />
                <Icon size={16} aria-hidden />
                <span>{item.label}</span>
                <IconButton
                  aria-label={`move ${item.label} up`}
                  disabled={index === 0}
                  onClick={() => {
                    const previous = items[index - 1]
                    if (previous) toolbar.move(item.id, previous.id)
                  }}
                >
                  <ArrowUp size={14} aria-hidden />
                </IconButton>
                <IconButton
                  aria-label={`move ${item.label} down`}
                  disabled={index === items.length - 1}
                  onClick={() => {
                    const next = items[index + 1]
                    if (next) toolbar.move(item.id, next.id, true)
                  }}
                >
                  <ArrowDown size={14} aria-hidden />
                </IconButton>
              </li>
            )
          })}
        </ol>
        <Button
          disabled={!preferences.order?.length}
          onClick={() => toolbar.setPreferences({ order: [] })}
        >
          reset order
        </Button>
      </details>
    </>
  )
}
