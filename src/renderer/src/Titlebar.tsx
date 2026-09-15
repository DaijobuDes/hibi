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
import { type Hotkeys, shortcutLabels } from '../../shared/hotkeys'
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
  onPalette,
  mode,
  onMode,
  onCommand,
  disabled,
  hotkeys,
  platform,
}: {
  document: DocumentState | null
  settingsOpen: boolean
  onSettings: () => void
  onPalette: () => void
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  onCommand: (command: DocumentCommand) => void
  disabled: boolean
  hotkeys: Hotkeys
  platform: string
}) {
  return (
    <header className="titlebar">
      {!settingsOpen && (
        <div className="document-actions">
          {(['new', 'open', 'save'] as const).map((command) => (
            <button
              type="button"
              key={command}
              aria-label={command}
              title={`${command}${hotkeys[command] ? ` (${shortcutLabels(hotkeys[command], platform).join('')})` : ''}`}
              disabled={disabled}
              onClick={() => onCommand(command)}
            >
              <Icon name={command} />
            </button>
          ))}
        </div>
      )}
      <div className="document-title">
        <button
          type="button"
          className="command-trigger"
          aria-label="command palette"
          title={`command palette${hotkeys.palette ? ` (${shortcutLabels(hotkeys.palette, platform).join('')})` : ''}`}
          onClick={onPalette}
        >
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
        </button>
      </div>
      <nav
        className="view-switch"
        aria-label={settingsOpen ? 'navigation' : 'editor view'}
      >
        {!settingsOpen &&
          (['normal', 'side-by-side', 'markdown'] as const).map((view) => {
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
