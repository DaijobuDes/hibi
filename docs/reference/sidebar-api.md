# shared sidebar api

generated from `src/ui/Sidebar.tsx`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
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
}
```
