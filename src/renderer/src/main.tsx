import {
  Component,
  type ErrorInfo,
  type ReactNode,
  StrictMode,
  useEffect,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import type { AppInfo } from '../../shared/desktop'
import './styles.css'

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
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    window.hibi
      .getAppInfo()
      .then((value) => {
        if (active) setInfo(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="app" data-platform={info?.platform}>
      <header className="titlebar">
        <span className="wordmark">hibi</span>
      </header>
      <main className="welcome">
        <h1>ready when you are.</h1>
        <p>a little room for what comes next.</p>
      </main>
      <footer>
        {failed ? (
          <p role="alert">
            could not connect to hibi.{' '}
            <button type="button" onClick={() => location.reload()}>
              retry
            </button>
          </p>
        ) : (
          <details>
            <summary>about hibi</summary>
            <p>
              {info
                ? `version ${info.version} · electron ${info.electron}`
                : 'loading app details…'}
            </p>
          </details>
        )}
      </footer>
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
