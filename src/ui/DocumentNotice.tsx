import { FileWarning, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '../shared/errors'

export function DocumentNotice({
  title,
  message,
  busy = false,
  children,
}: {
  title: string
  message?: string | undefined
  busy?: boolean
  children?: ReactNode
}) {
  const Icon = busy ? LoaderCircle : FileWarning
  return (
    <div className="document-notice" role="status" aria-live="polite">
      <Icon size={20} aria-hidden />
      <div>
        <p className="document-notice-title">{title}</p>
        {message && <p>{errorMessage(message)}</p>}
        {children}
      </div>
    </div>
  )
}
