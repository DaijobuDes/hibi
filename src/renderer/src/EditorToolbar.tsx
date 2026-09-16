import { Puzzle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button, Select, SettingRow, Toggle } from '../../ui/Controls'
import type { ToolbarPreferences } from '../../ui/toolbar'
import type { ViewMode } from './Editor'
import { toolbar } from './toolbar'

export function EditorToolbar({ mode }: { mode: ViewMode }) {
  const { preferences, items } = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.snapshot,
  )
  const visible = items.filter(
    (item) =>
      !item.when ||
      (item.when === 'source' ? mode !== 'normal' : mode !== 'markdown'),
  )
  if (!preferences.visible || !visible.length) return null
  return (
    <nav
      className="editor-toolbar"
      aria-label="editor toolbar"
      data-mode={preferences.mode}
    >
      {visible.map((item) => {
        const Icon = item.icon ?? Puzzle
        return (
          <Button
            key={item.id}
            aria-label={item.label}
            aria-pressed={item.pressed}
            disabled={item.disabled}
            data-tooltip={item.tooltip ?? item.label}
            onClick={() => void item.onClick()}
          >
            {preferences.mode !== 'text' && <Icon size={16} aria-hidden />}
            {preferences.mode !== 'icons' && <span>{item.label}</span>}
          </Button>
        )
      })}
    </nav>
  )
}

export function ToolbarSettings() {
  const { preferences } = useSyncExternalStore(
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
    </>
  )
}
