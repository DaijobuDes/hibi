import type { StatusItem } from '../../addons/api'
import { sentenceCase } from '../../shared/ui-case'

export function StatusBar({ items }: { items: readonly StatusItem[] }) {
  if (!items.length) return null
  return (
    <section className="app-statusbar" aria-label="Editor status">
      {items.map((item) =>
        item.onClick ? (
          <button
            key={item.id}
            type="button"
            className="status-pill"
            data-status-id={item.id}
            data-verbatim={item.verbatim}
            data-tooltip={item.tooltip}
            onClick={() => void item.onClick?.()}
          >
            {item.verbatim ? item.label : sentenceCase(item.label)}
          </button>
        ) : (
          <span
            key={item.id}
            className="status-pill"
            data-status-id={item.id}
            data-verbatim={item.verbatim}
            data-tooltip={item.tooltip}
            role="status"
          >
            {item.verbatim ? item.label : sentenceCase(item.label)}
          </span>
        ),
      )}
    </section>
  )
}
