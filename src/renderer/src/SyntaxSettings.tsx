import { useState, useSyncExternalStore } from 'react'
import { SettingRow, Toggle } from '../../ui/Controls'
import { SettingsFilter } from '../../ui/SettingsFilter'
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
      <SettingsFilter
        id="markdown-syntax-filter"
        label="filter syntax"
        placeholder="filter syntax…"
        value={query}
        onChange={setQuery}
        resetDisabled={features.every((feature) => feature.enabled)}
        onReset={markdownSyntax.reset}
      />
      {[...new Set(features.map((feature) => feature.group))].map((group) => (
        <div
          key={group}
          hidden={!matching.some((feature) => feature.group === group)}
        >
          <h2>{group}</h2>
          <div className="settings-group">
            {features
              .filter((feature) => feature.group === group)
              .map((feature) => (
                <SettingRow
                  key={feature.id}
                  id={`syntax-${feature.id}`}
                  label={feature.label}
                  description={feature.description}
                  hidden={!matching.includes(feature)}
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
