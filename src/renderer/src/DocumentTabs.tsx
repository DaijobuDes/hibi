import { X } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { DocumentState } from '../../shared/desktop'
import { IconButton } from '../../ui/Controls'

export function DocumentTabs({
  document,
  busy,
  onSelect,
  onClose,
}: {
  document: DocumentState
  busy: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const active = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the newly selected tab must remain visible in the scroll strip.
  useLayoutEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [document.tabId])
  return (
    <div
      className="document-tabs"
      role="tablist"
      aria-label="Open documents"
      onKeyDown={(event) => {
        if (
          busy ||
          !(event.target instanceof HTMLElement) ||
          event.target.getAttribute('role') !== 'tab'
        )
          return
        const index = document.tabs.findIndex(
          (tab) => tab.id === document.tabId,
        )
        const last = document.tabs.length - 1
        const next =
          event.key === 'ArrowRight'
            ? (index + 1) % (last + 1)
            : event.key === 'ArrowLeft'
              ? (index + last) % (last + 1)
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? last
                  : null
        if (next !== null) {
          event.preventDefault()
          const tab = document.tabs[next]
          if (tab) {
            onSelect(tab.id)
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-tab-id="${tab.id}"]`)
              ?.focus()
          }
        }
      }}
    >
      {document.tabs.map((tab) => {
        const selected = tab.id === document.tabId
        const name = selected ? document.name : tab.name
        const dirty = selected ? document.dirty : tab.dirty
        return (
          <div className="document-tab" key={tab.id} data-active={selected}>
            <button
              type="button"
              role="tab"
              id={`document-tab-${tab.id}`}
              aria-controls="document-editor-panel"
              className="document-name"
              data-tab-id={tab.id}
              ref={selected ? active : undefined}
              aria-label={name}
              aria-selected={selected}
              aria-description={dirty ? 'unsaved changes' : undefined}
              aria-disabled={busy}
              tabIndex={selected ? 0 : -1}
              title={name}
              onClick={() => {
                if (!busy && !selected) onSelect(tab.id)
              }}
            >
              <span>{name}</span>
              {dirty && (
                <span
                  className="dirty-dot"
                  role="status"
                  aria-label={
                    selected ? 'Unsaved changes' : `Unsaved changes in ${name}`
                  }
                >
                  •
                </span>
              )}
            </button>
            <IconButton
              className="tab-close"
              aria-label={`Close ${name}`}
              title="Close tab"
              disabled={busy}
              onClick={() => onClose(tab.id)}
            >
              <X size={12} />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}
