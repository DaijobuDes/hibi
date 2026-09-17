import {
  ArrowLeft,
  Check,
  Copy,
  File,
  FileWarning,
  RotateCcw,
  Save,
} from 'lucide-react'
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { DocumentState } from '../../shared/desktop'
import { Button } from '../../ui/Controls'
import './recovery.css'

export function RecoveryScreen({
  error,
  onBack,
}: {
  error: Error
  onBack?: () => void
}) {
  const [draft, setDraft] = useState<DocumentState | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!onBack) heading.current?.focus()
  }, [onBack])
  const details = error.stack || `${error.name}: ${error.message}`
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => window.hibi?.getDocument())
      .then((value) => {
        if (active && value) setDraft(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  async function saveCopy() {
    setBusy(true)
    setStatus('')
    try {
      const saved = await window.hibi.saveDocument(true)
      if (saved) {
        setDraft(saved)
        setStatus('copy saved.')
      }
    } catch {
      setStatus('could not save a copy. try again before reloading.')
    } finally {
      setBusy(false)
    }
  }
  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details)
      setCopied(true)
      setStatus('error details copied.')
    } catch {
      setStatus('could not copy details. you can select the text below.')
    }
  }
  return (
    <main
      className="recovery-screen"
      aria-label={onBack ? 'recovery screen preview' : 'editor recovery'}
    >
      <header className="recovery-chrome">
        <span>hibi</span>
        {onBack && <span>preview</span>}
      </header>
      <div className="recovery-body">
        <section className="recovery-content" aria-labelledby="recovery-title">
          <FileWarning
            className="recovery-icon"
            size={44}
            strokeWidth={1.25}
            aria-hidden
          />
          <h1 id="recovery-title" ref={heading} tabIndex={-1}>
            let’s get you back to writing.
          </h1>
          <p>
            {onBack
              ? 'this is a preview of hibi’s recovery screen. your editor is still open underneath.'
              : 'the editor ran into an unexpected error. reload hibi to try again.'}
          </p>
          {draft && (
            <div className="recovery-draft">
              <File size={16} aria-hidden />
              <span>{draft.name}</span>
              <span>
                {draft.dirty ? 'unsaved draft available' : 'document available'}
              </span>
            </div>
          )}
          {!onBack && draft?.dirty && (
            <p className="recovery-hint">
              the latest draft received by hibi is available in this window.
              save a copy before reloading if you need one.
            </p>
          )}
          <div className="recovery-actions">
            {onBack ? (
              <Button onClick={onBack}>
                <ArrowLeft />
                back to settings
              </Button>
            ) : (
              <>
                <Button
                  className="dialog-primary"
                  disabled={busy}
                  onClick={() => location.reload()}
                >
                  <RotateCcw />
                  reload hibi
                </Button>
                <Button
                  disabled={busy || !draft}
                  onClick={() => void saveCopy()}
                >
                  <Save />
                  {busy ? 'saving…' : 'save a copy'}
                </Button>
              </>
            )}
          </div>
          <details className="recovery-details">
            <summary>error details</summary>
            <pre>{details}</pre>
            <Button variant="ghost" onClick={() => void copyDetails()}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'copied' : 'copy details'}
            </Button>
          </details>
          <p className="recovery-status" role="status">
            {status}
          </p>
        </section>
      </div>
    </main>
  )
}

export class RecoveryBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render failed:', error, info.componentStack)
  }
  render() {
    return this.state.error ? (
      <RecoveryScreen error={this.state.error} />
    ) : (
      this.props.children
    )
  }
}
