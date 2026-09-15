import {
  ArrowLeft,
  Code,
  Columns2,
  FilePlus,
  FileText,
  FolderOpen,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import type { DocumentCommand, DocumentState } from '../../shared/desktop'
import type { ViewMode } from './Editor'

const icons = {
  new: FilePlus,
  open: FolderOpen,
  save: Save,
  normal: FileText,
  'side-by-side': Columns2,
  markdown: Code,
  settings: SlidersHorizontal,
  back: ArrowLeft,
} as const

function Icon({ name }: { name: keyof typeof icons }) {
  const Glyph = icons[name]
  return <Glyph size={16} strokeWidth={1.5} aria-hidden="true" />
}

export function Titlebar({
  document,
  settingsOpen,
  onSettings,
  mode,
  onMode,
  onCommand,
  disabled,
}: {
  document: DocumentState | null
  settingsOpen: boolean
  onSettings: () => void
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  onCommand: (command: DocumentCommand) => void
  disabled: boolean
}) {
  return (
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
        <span>{settingsOpen ? 'settings' : (document?.name ?? 'hibi')}</span>
        {!settingsOpen && document?.dirty && (
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
          disabled={disabled || settingsOpen || mode === 'markdown'}
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
              disabled={settingsOpen}
              onClick={() => onMode(view)}
            >
              <Icon name={view} />
            </button>
          )
        })}
        <button
          type="button"
          aria-label={settingsOpen ? 'back to editor' : 'editor settings'}
          title={settingsOpen ? 'back to editor' : 'editor settings'}
          aria-pressed={settingsOpen}
          onClick={onSettings}
        >
          <Icon name={settingsOpen ? 'back' : 'settings'} />
        </button>
      </nav>
    </header>
  )
}
