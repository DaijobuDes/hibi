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
import {
  type AppCommand,
  actions,
  defaultHotkeys,
  type Hotkeys,
} from '../../shared/hotkeys'
import './styles.css'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { MarkdownEditor, type ViewMode } from './Editor'
import { LoadingScreen } from './LoadingScreen'
import { SettingsScreen } from './SettingsScreen'
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
  const [typing, setTyping] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [hotkeys, setHotkeys] = useState<Hotkeys>(() =>
    defaultHotkeys('darwin'),
  )
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
    if (!settingsOpen) setFindOpen(false)
    setSettingsOpen(!settingsOpen)
    if (settingsOpen)
      requestAnimationFrame(() =>
        window.document
          .querySelector<HTMLElement>(
            mode === 'markdown' ? '.cm-content' : '.tiptap',
          )
          ?.focus(),
      )
  }

  function openFind() {
    showTitlebar()
    setPaletteOpen(false)
    if (findOpen) {
      const input =
        window.document.querySelector<HTMLInputElement>('.find-bar input')
      input?.focus()
      input?.select()
    }
    setSettingsOpen(false)
    setFindOpen(true)
  }

  useEffect(() => {
    let active = true
    Promise.all([
      window.hibi.getAppInfo(),
      window.hibi.getDocument(),
      window.hibi.getHotkeys(),
    ])
      .then(([info, document, hotkeys]) => {
        if (active) {
          setInfo(info)
          setDocument(document)
          setHotkeys(hotkeys)
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

  useEffect(() => window.hibi.onCommand(runAction))

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

  function runAction(command: AppCommand) {
    if (command === 'palette') {
      openPalette()
      return
    }
    setPaletteOpen(false)
    switch (command) {
      case 'new':
      case 'open':
      case 'save':
      case 'saveAs':
        void runCommand(command)
        break
      case 'find':
        openFind()
        break
      case 'settings':
        toggleSettings()
        break
      case 'normal':
      case 'side-by-side':
      case 'markdown':
        showTitlebar()
        setSettingsOpen(false)
        setMode(command)
        break
      case 'toggle-titlebar':
        setHideTitlebar(!hideTitlebar)
        showTitlebar()
        break
    }
  }

  if (!document && !failed) return <LoadingScreen full />

  const paletteCommands: PaletteCommand[] = actions
    .filter(
      ({ id, category }) => id !== 'palette' && !(category === 'file' && busy),
    )
    .map(({ id, label, category }) => ({
      id,
      category,
      label:
        id === 'settings' && settingsOpen
          ? 'back to editor'
          : id === 'toggle-titlebar'
            ? hideTitlebar
              ? 'keep top bar visible'
              : 'hide top bar while typing'
            : label,
      shortcut: hotkeys[id],
      run: () => runAction(id),
    }))

  return (
    <div
      className="app"
      data-platform={info?.platform}
      data-screen={settingsOpen ? 'settings' : 'editor'}
      data-typing={typing}
      onInputCapture={(event) => noteTyping(event.target)}
      onKeyDownCapture={(event) => {
        if (
          (event.target as HTMLElement).closest(
            '.hotkey-recorder[aria-pressed="true"]',
          )
        )
          return
        if (
          event.key === 'Escape' &&
          findOpen &&
          !settingsOpen &&
          !paletteOpen
        ) {
          event.preventDefault()
          setFindOpen(false)
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
        hotkeys={hotkeys}
        platform={info?.platform ?? 'darwin'}
        document={document}
        settingsOpen={settingsOpen}
        onSettings={toggleSettings}
        onPalette={openPalette}
        mode={mode}
        onMode={(view) => {
          showTitlebar()
          setMode(view)
        }}
        onCommand={(command) => void runCommand(command)}
        disabled={busy || !document}
      />
      {paletteOpen && (
        <CommandPalette
          platform={info?.platform ?? 'darwin'}
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <SettingsScreen
        open={settingsOpen}
        hotkeys={hotkeys}
        onHotkeys={setHotkeys}
        padding={padding}
        onPadding={setPadding}
        hideTitlebar={hideTitlebar}
        onHideTitlebar={(value) => {
          setHideTitlebar(value)
          showTitlebar()
        }}
        info={info}
      />
      <div
        className="editor-surface"
        aria-hidden={settingsOpen}
        inert={settingsOpen}
      >
        {document && (
          <MarkdownEditor
            key={`${document.revision}-${resetEditor}`}
            value={document.markdown}
            onChange={updateMarkdown}
            mode={mode}
            disabled={busy}
            findOpen={findOpen && !settingsOpen}
            onCloseFind={() => setFindOpen(false)}
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
