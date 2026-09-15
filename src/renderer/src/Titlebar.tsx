import { useEffect, useState } from 'react'
import type {
  AppInfo,
  DocumentCommand,
  DocumentState,
} from '../../shared/desktop'
import type { ViewMode } from './Editor'

const icons = {
  new: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 12v6 M9 15h6',
  open: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2 M3 7h5l2 3h11l-3 10H3z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z M7 3v6h10V3 M7 21v-8h10v8',
  normal: 'M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5',
  'side-by-side': 'M3 4h18v16H3z M12 4v16',
  markdown: 'M8 6l-6 6 6 6 M16 6l6 6-6 6',
  settings: 'M4 7h7 M15 7h5 M4 17h3 M11 17h9 M11 4v6 M7 14v6',
} as const

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  )
}

export function Titlebar({
  document,
  info,
  mode,
  onMode,
  onCommand,
  disabled,
}: {
  document: DocumentState | null
  info: AppInfo | null
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  onCommand: (command: DocumentCommand) => void
  disabled: boolean
}) {
  const [padding, setPadding] = useState(() => {
    const stored = Number(localStorage.getItem('editor-padding') ?? 8)
    return Number.isInteger(stored) && stored >= 0 && stored <= 48 ? stored : 8
  })
  useEffect(() => {
    window.document.documentElement.style.setProperty(
      '--editor-padding',
      `${padding}px`,
    )
    localStorage.setItem('editor-padding', String(padding))
  }, [padding])

  return (
    <>
      <header className="titlebar">
        <div className="document-actions">
          {(['new', 'open', 'save'] as const).map((command) => (
            <button
              type="button"
              key={command}
              aria-label={command}
              title={command}
              disabled={disabled}
              onClick={() => onCommand(command)}
            >
              <Icon name={command} />
            </button>
          ))}
        </div>
        <div className="document-title" title={document?.name}>
          <span>{document?.name ?? 'hibi'}</span>
          {document?.dirty && (
            <span
              className="dirty-dot"
              role="status"
              aria-label="unsaved changes"
            >
              •
            </span>
          )}
        </div>
        <nav className="view-switch" aria-label="editor view">
          <button
            type="button"
            aria-label="format"
            title="format"
            popoverTarget="format-menu"
            disabled={disabled || mode === 'markdown'}
          >
            Aa
          </button>
          {(['normal', 'side-by-side', 'markdown'] as const).map((view) => {
            const label = view === 'markdown' ? 'markdown only' : view
            return (
              <button
                type="button"
                key={view}
                aria-label={label}
                title={label}
                aria-pressed={mode === view}
                onClick={() => onMode(view)}
              >
                <Icon name={view} />
              </button>
            )
          })}
          <button
            type="button"
            aria-label="editor settings"
            title="editor settings"
            popoverTarget="editor-settings"
          >
            <Icon name="settings" />
          </button>
        </nav>
      </header>
      <div id="editor-settings" className="settings-menu" popover="auto">
        <label htmlFor="editor-padding">
          editor padding <output>{padding} px</output>
        </label>
        <input
          id="editor-padding"
          type="range"
          min="0"
          max="48"
          step="4"
          value={padding}
          onChange={(event) => setPadding(Number(event.target.value))}
        />
        <details>
          <summary>about hibi</summary>
          <p>
            {info
              ? `version ${info.version} · electron ${info.electron}`
              : 'loading app details…'}
          </p>
        </details>
      </div>
    </>
  )
}
