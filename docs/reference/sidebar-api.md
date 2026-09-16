# shared sidebar api

generated from `src/ui/Sidebar.tsx`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
export type SidebarItem = {
  id: string
  label: string
  icon?: LucideIcon
  children?: SidebarItem[]
  /** Optional section label immediately before this row. */
  section?: string
  dirty?: boolean
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
  onMenu?: (id: string, anchor: HTMLElement) => void
  editing?: {
    id: string
    value: string
    disabled: boolean
    onChange: (value: string) => void
    onCommit: () => void
    onCancel: () => void
  } | null
  resize?: {
    width: number
    maxWidth: number
    onChange: (width: number) => void
    onReset: () => void
  }
}

function RenameInput({
  editing,
}: {
  editing: NonNullable<SidebarProps['editing']>
}) {
  const input = useRef<HTMLInputElement>(null)
  const id = editing.id
  useLayoutEffect(() => {
    const element = input.current
    if (!id || !element) return
    element.focus()
    const dot = element.value.lastIndexOf('.')
    element.setSelectionRange(0, dot > 0 ? dot : element.value.length)
    element.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <input
      ref={input}
      className="sidebar-rename"
      aria-label="rename item"
      value={editing.value}
      disabled={editing.disabled}
      onChange={(event) => editing.onChange(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          editing.onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          editing.onCancel()
        }
      }}
    />
  )
}
```
