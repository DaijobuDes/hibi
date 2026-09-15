import { useState } from 'react'
import { SettingRow, Toggle } from '../ui'

export function propertiesExpanded() {
  return localStorage.getItem('frontmatter:expanded') !== 'false'
}

export function Settings() {
  const [expanded, setExpanded] = useState(propertiesExpanded)
  return (
    <div className="settings-group">
      <SettingRow
        id="frontmatter-expanded"
        label="expand properties by default"
        description="show the property rows when a note opens."
      >
        <Toggle
          id="frontmatter-expanded"
          checked={expanded}
          onChange={(event) => {
            setExpanded(event.target.checked)
            localStorage.setItem(
              'frontmatter:expanded',
              String(event.target.checked),
            )
          }}
        />
      </SettingRow>
    </div>
  )
}
