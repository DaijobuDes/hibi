import {
  Component,
  type ErrorInfo,
  type ReactNode,
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import type {
  AppInfo,
  DocumentCommand,
  DocumentState,
} from '../../shared/desktop'
import { MAX_DOCUMENT_BYTES } from '../../shared/desktop'
import './styles.css'
import { MarkdownEditor, type ViewMode } from './Editor'
import { Titlebar } from './Titlebar'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render failed:', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="welcome" role="alert">
          <h1>something went wrong.</h1>
          <p>reload hibi to try again.</p>
          <button type="button" onClick={() => location.reload()}>
            reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

function App() {
  const [document, setDocument] = useState<DocumentState | null>(null)
  const [resetEditor, setResetEditor] = useState(0)
  const savedText = useRef('')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<ViewMode>('normal')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([window.hibi.getAppInfo(), window.hibi.getDocument()])
      .then(([info, document]) => {
        if (active) {
          setInfo(info)
          setDocument(document)
          savedText.current = document.savedMarkdown
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  const runCommand = useCallback(async (command: DocumentCommand) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await (command === 'new'
        ? window.hibi.newDocument()
        : command === 'open'
          ? window.hibi.openDocument()
          : window.hibi.saveDocument(command === 'saveAs'))
      if (next) {
        setDocument(next)
        savedText.current = next.savedMarkdown
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'could not complete file operation.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(
    () =>
      window.hibi.onDocumentCommand((command) => {
        void runCommand(command)
      }),
    [runCommand],
  )

  function updateMarkdown(markdown: string) {
    if (new TextEncoder().encode(markdown).length > MAX_DOCUMENT_BYTES) {
      setError('documents must stay under 2 mib. this edit was not applied.')
      setResetEditor((value) => value + 1)
      return
    }
    setDocument((current) =>
      current
        ? { ...current, markdown, dirty: markdown !== savedText.current }
        : current,
    )
    void window.hibi
      .updateDocument(markdown)
      .catch((error: unknown) =>
        setError(
          error instanceof Error
            ? error.message
            : 'could not preserve changes.',
        ),
      )
  }

  return (
    <div className="app" data-platform={info?.platform}>
      <Titlebar
        document={document}
        info={info}
        mode={mode}
        onMode={setMode}
        onCommand={(command) => void runCommand(command)}
        disabled={busy || !document}
      />
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {document && (
        <MarkdownEditor
          key={`${document.revision}-${resetEditor}`}
          value={document.markdown}
          onChange={updateMarkdown}
          mode={mode}
          disabled={busy}
        />
      )}
      {failed && (
        <p role="alert">
          could not connect to hibi.{' '}
          <button type="button" onClick={() => location.reload()}>
            retry
          </button>
        </p>
      )}
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('missing root element')
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
