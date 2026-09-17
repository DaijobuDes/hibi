import { ChevronDown } from 'lucide-react'
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react'
import { SettingsDiscovery, settingsIndex } from './settings-index'
import './controls.css'

type FieldStyle = {
  /** Subtle fields blend into property rows; inline fields sit inside another control. */
  variant?: 'default' | 'subtle' | 'inline'
  monospace?: boolean
}

export function TextInput({
  className = '',
  variant = 'default',
  monospace = false,
  type = 'text',
  ...props
}: ComponentProps<'input'> & FieldStyle) {
  return (
    <input
      {...props}
      type={type}
      data-variant={variant}
      className={`ui-field ui-input${monospace ? ' ui-code-field' : ''} ${className}`}
    />
  )
}

export function TextArea({
  className = '',
  variant = 'default',
  monospace = false,
  ...props
}: ComponentProps<'textarea'> & FieldStyle) {
  return (
    <textarea
      {...props}
      data-variant={variant}
      className={`ui-field ui-textarea${monospace ? ' ui-code-field' : ''} ${className}`}
    />
  )
}

/** Shared spacing for extension panels and wrapping rows of controls. */
export function Panel({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} className={`ui-panel ${className}`} />
}

export function ControlRow({
  className = '',
  ...props
}: ComponentProps<'div'>) {
  return <div {...props} className={`ui-control-row ${className}`} />
}

export function Button({
  className = '',
  variant = 'default',
  title,
  ...props
}: ComponentProps<'button'> & { variant?: 'default' | 'ghost' | 'row' }) {
  return (
    <button
      type="button"
      data-tooltip={title}
      {...props}
      data-variant={variant}
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

/** Native range semantics with a shared themed track and thumb. */
export function Slider({
  min = 0,
  max = 100,
  value,
  style,
  className = '',
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'defaultValue'> & { value: number }) {
  const range = Number(max) - Number(min)
  const fill =
    range > 0
      ? Math.max(0, Math.min(100, ((value - Number(min)) / range) * 100))
      : 0
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      className={`ui-slider ${className}`}
      style={{ ...style, '--slider-fill': `${fill}%` } as CSSProperties}
    />
  )
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
  const row = useRef<HTMLDivElement>(null)
  const discover = useContext(SettingsDiscovery)
  useEffect(() => {
    if (discover && row.current)
      return settingsIndex.register(row.current, id, label)
  }, [discover, id, label])
  return (
    <div className="setting-row" ref={row}>
      <div className="setting-copy">
        <label htmlFor={id}>{label}</label>
        <p id={`${id}-description`}>{description}</p>
      </div>
      {children}
    </div>
  )
}
