import { useState, useSyncExternalStore } from 'react'
import { SettingRow, Toggle } from '../../ui/Controls'
import { codeLanguages } from './code-languages'

export function CodeSyntaxSettings() {
  const languages = useSyncExternalStore(
    codeLanguages.subscribe,
    codeLanguages.snapshot,
  )
  const [query, setQuery] = useState('')
  const matching = languages.filter((language) =>
    [language.id, ...language.aliases, language.owner]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  )
  return (
    <>
      <h1>code syntax</h1>
      <div className="settings-group">
        <SettingRow
          id="code-syntax-filter"
          label="filter languages"
          description="disabled languages remain readable as plain code."
        >
          <input
            type="search"
            className="settings-filter"
            id="code-syntax-filter"
            placeholder="filter languages…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </SettingRow>
      </div>
      {[...new Set(matching.map((language) => language.owner))].map((owner) => (
        <div key={owner}>
          <h2>
            {owner === 'built-in' ? 'languages' : owner.replaceAll('-', ' ')}
          </h2>
          <div className="settings-group">
            {matching
              .filter((language) => language.owner === owner)
              .map((language) => (
                <SettingRow
                  key={language.id}
                  id={`code-syntax-${language.id}`}
                  label={language.id}
                  description={
                    language.aliases.length
                      ? `also applies to ${language.aliases.join(', ')}.`
                      : 'highlight matching code blocks.'
                  }
                >
                  <Toggle
                    id={`code-syntax-${language.id}`}
                    checked={language.enabled}
                    onChange={(event) =>
                      codeLanguages.setEnabled(
                        language.id,
                        event.target.checked,
                      )
                    }
                  />
                </SettingRow>
              ))}
          </div>
        </div>
      ))}
      {!matching.length && <p>no matching languages.</p>}
    </>
  )
}
