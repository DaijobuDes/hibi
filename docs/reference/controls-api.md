# shared controls

generated from `src/ui/Controls.tsx`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```tsx
import { ChevronDown } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

export function Button({
  className = '',
  title,
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-tooltip={title}
      {...props}
      className={`ui-button ${className}`}
    />
  )
}

export function Select({ children, ...props }: ComponentProps<'select'>) {
  return (
    <span className="select-control">
      <select {...props}>{children}</select>
      <ChevronDown aria-hidden="true" />
    </span>
  )
}

export function IconButton({
  className = '',
  title,
  ...props
}: ComponentProps<'button'> & { 'aria-label': string }) {
  return (
    <button
      type="button"
      data-tooltip={title}
      {...props}
      className={`icon-button ${className}`}
    />
  )
}

export function Toggle(
  props: Omit<ComponentProps<'input'>, 'type' | 'className'>,
) {
  return <input {...props} type="checkbox" className="setting-toggle" />
}

export function SettingRow({
  id,
  label,
  description,
  children,
}: {
  id: string
  label: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <label htmlFor={id}>{label}</label>
        <p id={`${id}-description`}>{description}</p>
      </div>
      {children}
    </div>
  )
}
```
