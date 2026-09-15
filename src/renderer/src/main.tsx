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
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { MarkdownEditor, type ViewMode } from './Editor'
import { LoadingScreen } from './LoadingScreen'
import { SettingsScreen } from './SettingsScreen'
import { Titlebar } from './Titlebar'
import { animateChange } from './transitions'

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
  const [typing, setTyping] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [padding, setPadding] = useState(() => {
    const value = Number(localStorage.getItem('editor-padding') ?? 48)
    return Number.isInteger(value) && value >= 0 && value <= 96 ? value : 48
  })
  const [hideTitlebar, setHideTitlebar] = useState(
    () => localStorage.getItem('hide-titlebar') !== 'false',
  )
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => () => clearTimeout(typingTimer.current), [])
  useEffect(() => {
    window.document.documentElement.style.setProperty(
      '--editor-padding',
      `${padding}px`,
    )
    localStorage.setItem('editor-padding', String(padding))
    localStorage.setItem('hide-titlebar', String(hideTitlebar))
  }, [padding, hideTitlebar])

  function showTitlebar() {
    clearTimeout(typingTimer.current)
    setTyping(false)
  }

  function noteTyping(target: EventTarget) {
    if (
      settingsOpen ||
      paletteOpen ||
      !hideTitlebar ||
      !(target instanceof HTMLElement) ||
      !target.closest('[contenteditable="true"]')
    )
      return
    clearTimeout(typingTimer.current)
    setTyping(true)
    typingTimer.current = setTimeout(() => setTyping(false), 1200)
  }

  function openPalette() {
    showTitlebar()
    setPaletteOpen(true)
  }

  function toggleSettings() {
    showTitlebar()
    void animateChange(() => setSettingsOpen(!settingsOpen)).then(() => {
      if (settingsOpen)
        requestAnimationFrame(() =>
          window.document
            .querySelector<HTMLElement>(
              mode === 'markdown' ? '.cm-content' : '.tiptap',
            )
            ?.focus(),
        )
    })
  }

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
        if (command === 'new' || command === 'open') setSettingsOpen(false)
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

  if (!document && !failed) return <LoadingScreen full />

  const modifier = info?.platform === 'darwin' ? '⌘' : 'ctrl+'
  const paletteCommands: PaletteCommand[] = [
    ...(!busy && document
      ? (['new', 'open', 'save', 'saveAs'] as const).map((command) => ({
          id: command,
          label: `file: ${command === 'saveAs' ? 'save as…' : command === 'new' ? 'new document' : command === 'open' ? 'open document…' : 'save document'}`,
          shortcut: `${modifier}${command === 'new' ? 'n' : command === 'open' ? 'o' : command === 'saveAs' ? 'shift+s' : 's'}`,
          run: () => {
            void runCommand(command)
          },
        }))
      : []),
    ...(['normal', 'side-by-side', 'markdown'] as const).map((view) => ({
      id: `view-${view}`,
      label: `view: ${view === 'markdown' ? 'markdown only' : view}`,
      run: () => {
        void animateChange(() => {
          setSettingsOpen(false)
          setMode(view)
        })
      },
    })),
    {
      id: 'settings',
      label: settingsOpen
        ? 'view: back to editor'
        : 'preferences: open settings',
      shortcut: `${modifier},`,
      run: toggleSettings,
    },
    {
      id: 'toggle-titlebar',
      label: hideTitlebar
        ? 'appearance: keep top bar visible'
        : 'appearance: hide top bar while typing',
      run: () => {
        setHideTitlebar(!hideTitlebar)
        showTitlebar()
      },
    },
  ]

  return (
    <div
      className="app"
      data-platform={info?.platform}
      data-screen={settingsOpen ? 'settings' : 'editor'}
      data-typing={typing}
      onInputCapture={(event) => noteTyping(event.target)}
      onKeyDownCapture={(event) => {
        if (
          ((event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === 'p') ||
          event.key === 'F1'
        ) {
          event.preventDefault()
          openPalette()
          return
        }
        if ((event.metaKey || event.ctrlKey) && event.key === ',') {
          event.preventDefault()
          showTitlebar()
          void animateChange(() => setSettingsOpen(true))
          return
        }
        if (event.key === 'Escape' && settingsOpen && !paletteOpen) {
          event.preventDefault()
          toggleSettings()
          return
        }
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          (event.key.length === 1 ||
            ['Enter', 'Backspace', 'Delete'].includes(event.key))
        )
          noteTyping(event.target)
      }}
      onPointerMove={(event) => {
        if (event.clientY <= 36) showTitlebar()
      }}
      onFocusCapture={(event) => {
        if (event.target.closest('.titlebar')) showTitlebar()
      }}
    >
      <Titlebar
        document={document}
        settingsOpen={settingsOpen}
        onSettings={toggleSettings}
        onPalette={openPalette}
        mode={mode}
        onMode={(view) => {
          void animateChange(() => setMode(view))
        }}
        onCommand={(command) => void runCommand(command)}
        disabled={busy || !document}
      />
      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {settingsOpen && (
        <SettingsScreen
          padding={padding}
          onPadding={setPadding}
          hideTitlebar={hideTitlebar}
          onHideTitlebar={(value) => {
            setHideTitlebar(value)
            showTitlebar()
          }}
          info={info}
        />
      )}
      <div className="editor-surface" hidden={settingsOpen}>
        {document && (
          <MarkdownEditor
            key={`${document.revision}-${resetEditor}`}
            value={document.markdown}
            onChange={updateMarkdown}
            mode={mode}
            disabled={busy}
          />
        )}
      </div>
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
