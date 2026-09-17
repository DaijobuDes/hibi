import { useState, useSyncExternalStore } from 'react'
import { Button, Select, SettingRow, Toggle } from '../../ui/Controls'
import { type FlavorChoice, flavors, type RegisteredFlavor } from './flavors'

export function FlavorPicker({
  initial,
  known,
  onChange,
  onEnable,
}: {
  initial: FlavorChoice
  known: readonly RegisteredFlavor[]
  onChange: (choice: FlavorChoice) => void
  onEnable: (id: string) => Promise<void>
}) {
  const [choice, setChoice] = useState(initial)
  const available = useSyncExternalStore(flavors.subscribe, flavors.snapshot)
  const change = (next: FlavorChoice) => {
    setChoice(next)
    onChange(next)
  }
  return (
    <div className="settings-group">
      <SettingRow
        id="file-dialect"
        label="Markdown dialect"
        description="Automatic mode recognizes features from enabled extensions."
      >
        <Select
          id="file-dialect"
          value={choice.dialect}
          onChange={(event) =>
            change({ ...choice, dialect: event.target.value })
          }
        >
          <option value="auto">Automatic</option>
          <option value="markdown">Plain Markdown</option>
          {available
            .filter((flavor) => flavor.kind === 'dialect')
            .map((flavor) => (
              <option key={flavor.id} value={flavor.id}>
                {flavor.name}
              </option>
            ))}
        </Select>
      </SettingRow>
      <SettingRow
        id="file-syntax-auto"
        label="Detect extra syntax"
        description="Recognize math and other enabled syntax extensions automatically."
      >
        <Toggle
          id="file-syntax-auto"
          checked={choice.syntax === 'auto'}
          onChange={(event) =>
            change({ ...choice, syntax: event.target.checked ? 'auto' : [] })
          }
        />
      </SettingRow>
      {known
        .filter((flavor) => flavor.kind === 'syntax')
        .map((flavor) => {
          const enabled = available.some((entry) => entry.id === flavor.id)
          return (
            <SettingRow
              key={flavor.id}
              id={`file-syntax-${flavor.id}`}
              label={flavor.name}
              description={flavor.description}
            >
              {enabled ? (
                <Toggle
                  id={`file-syntax-${flavor.id}`}
                  checked={
                    choice.syntax === 'auto' ||
                    choice.syntax.includes(flavor.id)
                  }
                  disabled={choice.syntax === 'auto'}
                  onChange={(event) =>
                    change({
                      ...choice,
                      syntax: event.target.checked
                        ? [
                            ...(choice.syntax === 'auto' ? [] : choice.syntax),
                            flavor.id,
                          ]
                        : (choice.syntax === 'auto'
                            ? []
                            : choice.syntax
                          ).filter((id) => id !== flavor.id),
                    })
                  }
                />
              ) : (
                <Button onClick={() => void onEnable(flavor.addonId)}>
                  Enable extension
                </Button>
              )}
            </SettingRow>
          )
        })}
    </div>
  )
}
