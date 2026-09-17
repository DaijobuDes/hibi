# shared settings filter

generated from `src/ui/SettingsFilter.tsx`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```tsx
import { useEffect, useRef } from 'react'
import { Button, TextInput } from './Controls'

/** Compact search/reset row shared by searchable settings pages. */
export function SettingsFilter({
  id,
  label,
  placeholder,
  value,
  onChange,
  onReset,
  resetDisabled,
  disabled = false,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onReset: () => void
  resetDisabled: boolean
  disabled?: boolean
}) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panel = row.current?.closest('[role="tabpanel"]')
    const reveal = () => onChange('')
    panel?.addEventListener('hibi:reveal-setting', reveal)
    return () => panel?.removeEventListener('hibi:reveal-setting', reveal)
  }, [onChange])
  return (
    <div className="settings-filter-bar" ref={row}>
      <TextInput
        id={id}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button disabled={disabled || resetDisabled} onClick={onReset}>
        Reset all
      </Button>
    </div>
  )
}
```
