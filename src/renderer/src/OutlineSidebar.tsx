import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
} from 'lucide-react'
import { Sidebar, type SidebarProps } from '../../ui/Sidebar'

export type OutlineHeading = { id: string; label: string; level: number }
export type OutlineRequest = { id: string; request: number }
export type SidebarView = 'workspace' | 'outline'
const icons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6]

export function OutlineSidebar({
  headings,
  selected,
  onSelect,
  open,
  resize,
}: {
  headings: readonly OutlineHeading[]
  selected: string | null
  onSelect: (id: string) => void
  open: boolean
  resize: NonNullable<SidebarProps['resize']>
}) {
  return (
    <Sidebar
      className="document-sidebar outline-sidebar"
      open={open}
      resize={resize}
      label="In this page"
      header={<span>In this page</span>}
      items={headings.map((heading) => ({
        ...heading,
        icon: icons[heading.level - 1] ?? Heading1,
      }))}
      selected={selected}
      onSelect={onSelect}
      empty="headings in this note appear here."
    />
  )
}
