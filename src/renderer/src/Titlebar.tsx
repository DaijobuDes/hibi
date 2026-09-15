import {
  Code,
  Columns2,
  FilePlus,
  FileText,
  FolderOpen,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  AppInfo,
  DocumentCommand,
  DocumentState,
} from '../../shared/desktop'
import type { ViewMode } from './Editor'

const icons = {
  new: FilePlus,
  open: FolderOpen,
  save: Save,
  normal: FileText,
  'side-by-side': Columns2,
  markdown: Code,
  settings: SlidersHorizontal,
} as const

function Icon({ name }: { name: keyof typeof icons }) {
  const Glyph = icons[name]
  return <Glyph size={16} strokeWidth={1.5} aria-hidden="true" />
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
    const stored = Number(localStorage.getItem('editor-padding') ?? 24)
    return Number.isInteger(stored) && stored >= 0 && stored <= 48 ? stored : 24
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
