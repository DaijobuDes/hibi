import { useState, useSyncExternalStore } from 'react'
import { SettingRow, TextInput, Toggle } from '../../ui/Controls'
import { markdownSyntax } from './markdown-syntax'

export function SyntaxSettings() {
  const features = useSyncExternalStore(
    markdownSyntax.subscribe,
    markdownSyntax.snapshot,
  )
  const [query, setQuery] = useState('')
  const matching = features.filter((feature) =>
    `${feature.label} ${feature.group} ${feature.description ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  return (
    <>
      <h1>syntax</h1>
      <div className="settings-group">
        <SettingRow
          id="markdown-syntax-filter"
          label="filter syntax"
          description="disabled formatting appears as its original markdown. source text stays intact."
        >
          <TextInput
            type="search"
            className="settings-filter"
            id="markdown-syntax-filter"
            placeholder="filter syntax…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </SettingRow>
      </div>
      {[...new Set(matching.map((feature) => feature.group))].map((group) => (
        <div key={group}>
          <h2>{group}</h2>
          <div className="settings-group">
            {matching
              .filter((feature) => feature.group === group)
              .map((feature) => (
                <SettingRow
                  key={feature.id}
                  id={`syntax-${feature.id}`}
                  label={feature.label}
                  description={feature.description}
                >
                  <Toggle
                    id={`syntax-${feature.id}`}
                    checked={feature.enabled}
                    onChange={(event) =>
                      markdownSyntax.setEnabled(
                        feature.id,
                        event.target.checked,
                      )
                    }
                  />
                </SettingRow>
              ))}
          </div>
        </div>
      ))}
      {!matching.length && <p>no matching syntax.</p>}
    </>
  )
}
