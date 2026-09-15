import { useState } from 'react'
import { SettingRow, Toggle } from '../ui'

export function vimPreferences() {
  return {
    insert: localStorage.getItem('vim:insert') === 'true',
    status: localStorage.getItem('vim:status') !== 'false',
  }
}

export function Settings() {
  const [preferences, setPreferences] = useState(vimPreferences)
  return (
    <div className="settings-group">
      {(
        [
          [
            'insert',
            'start in insert mode',
            'begin new source editor sessions in insert mode.',
          ],
          [
            'status',
            'show vim status',
            'show the current mode; command prompts always remain available.',
          ],
        ] as const
      ).map(([key, label, description]) => (
        <SettingRow
          key={key}
          id={`vim-${key}`}
          label={label}
          description={description}
        >
          <Toggle
            id={`vim-${key}`}
            checked={preferences[key]}
            onChange={(event) => {
              setPreferences({
                ...preferences,
                [key]: event.target.checked,
              })
              localStorage.setItem(`vim:${key}`, String(event.target.checked))
              window.dispatchEvent(new Event('hibi:vim-settings'))
            }}
          />
        </SettingRow>
      ))}
    </div>
  )
}
