import { useSyncExternalStore } from 'react'
import { Select, SettingRow, Toggle } from '../../ui/Controls'
import { autosave, autosaveDelays } from './autosave'

export function AutosaveSettings() {
  const settings = useSyncExternalStore(autosave.subscribe, autosave.snapshot)
  return (
    <>
      <h2>saving</h2>
      <div className="settings-group">
        <SettingRow
          id="autosave-enabled"
          label="autosave"
          description="save local files after a pause. new drafts need an initial save; files changed outside hibi pause autosave."
        >
          <Toggle
            id="autosave-enabled"
            checked={settings.enabled}
            onChange={(event) =>
              autosave.set({ enabled: event.target.checked })
            }
          />
        </SettingRow>
        <SettingRow
          id="autosave-delay"
          label="save after"
          description="wait this long after your last edit."
        >
          <Select
            id="autosave-delay"
            value={settings.delay}
            disabled={!settings.enabled}
            onChange={(event) =>
              autosave.set({ delay: Number(event.target.value) })
            }
          >
            {autosaveDelays.map((delay) => (
              <option key={delay} value={delay}>
                {delay / 1000} {delay === 1000 ? 'second' : 'seconds'}
              </option>
            ))}
          </Select>
        </SettingRow>
      </div>
    </>
  )
}
