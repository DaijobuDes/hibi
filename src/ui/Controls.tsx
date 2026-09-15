import type { ComponentProps, ReactNode } from 'react'

export function IconButton({
  className = '',
  ...props
}: ComponentProps<'button'> & { 'aria-label': string }) {
  return (
    <button type="button" {...props} className={`icon-button ${className}`} />
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
  description: string
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
