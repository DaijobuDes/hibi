import { useEffect, useState } from 'react'
import { Select, SettingRow, Toggle } from '../ui'
import { getPreferences, setPreferences, settingsEvent } from './preferences'
import { profiles } from './profiles'

export function Settings() {
  const [preferences, update] = useState(getPreferences)
  useEffect(() => {
    const change = () => update(getPreferences())
    window.addEventListener(settingsEvent, change)
    return () => window.removeEventListener(settingsEvent, change)
  }, [])
  return (
    <div className="settings-group">
      <SettingRow
        id="keybeats-profile"
        label="keyboard"
        description="choose a mechanical keyboard sound profile."
      >
        <Select
          id="keybeats-profile"
          value={preferences.profile}
          onChange={(event) => setPreferences({ profile: event.target.value })}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        id="keybeats-volume"
        label="volume"
        description="sound level while typing in normal and source panes."
      >
        <div className="setting-controls">
          <div className="padding-control">
            <input
              id="keybeats-volume"
              type="range"
              min="0"
              max="100"
              value={Math.round(preferences.volume * 100)}
              onChange={(event) =>
                setPreferences({ volume: Number(event.target.value) / 100 })
              }
            />
            <output htmlFor="keybeats-volume">
              {Math.round(preferences.volume * 100)}%
            </output>
          </div>
        </div>
      </SettingRow>
      <SettingRow
        id="keybeats-muted"
        label="mute"
        description="temporarily silence keyboard sounds."
      >
        <Toggle
          id="keybeats-muted"
          checked={preferences.muted}
          onChange={(event) => setPreferences({ muted: event.target.checked })}
        />
      </SettingRow>
    </div>
  )
}
