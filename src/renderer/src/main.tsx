import { X } from 'lucide-react'
import {
  Component,
  type CSSProperties,
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
import { IconButton } from '../../ui/Controls'
import { DialogProvider, useDialogs } from '../../ui/DialogProvider'
import './styles.css'
import type { WorkspaceState } from '../../shared/workspace'
import { useSidebarResize } from '../../ui/useSidebarResize'
import { useAddons } from './addons'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { MarkdownEditor, type ViewMode } from './Editor'
import { loadCursor } from './EditorCursor'
import { LoadingScreen } from './LoadingScreen'
import { projectMarkdown } from './markdown'
import { SettingsScreen } from './SettingsScreen'
import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'
import { WorkspaceSidebar } from './WorkspaceSidebar'

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
  const dialogs = useDialogs()
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
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebar-open') !== 'false',
  )
  const sidebarResize = useSidebarResize(196)
  const [cursorSettings, setCursorSettings] = useState(loadCursor)
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem('line-numbers') === 'true',
  )
  useEffect(() => {
    localStorage.setItem('line-numbers', String(showLineNumbers))
  }, [showLineNumbers])
  useEffect(() => {
    localStorage.setItem('cursor-settings', JSON.stringify(cursorSettings))
  }, [cursorSettings])
  const [notice, setNotice] = useState('')
  const addonHost = useAddons({
    getMarkdown: () => document?.markdown ?? '',
    runAction: (command) => runAction(command),
    runCommand: (command) => runCommand(command),
    updateMarkdown(transform, options) {
      if (busyRef.current || !document) throw new Error('the document is busy.')
      const source = options
        ? projectMarkdown(
            document.markdown,
            addonHost.markdownExtensions,
          ).serialize(options.body)
        : document.markdown
      const markdown = transform(source)
      if (markdown === null || markdown === document.markdown) return
      updateMarkdown(markdown)
      setResetEditor((value) => value + 1)
    },
    workspace: {
      get: () => window.hibi.getWorkspace(),
      open: openFolder,
      openFile: openFile,
    },
    invoke: async (id, method, input) => {
      if (busyRef.current) throw new Error('another operation is in progress.')
      busyRef.current = true
      setBusy(true)
      try {
        return await window.hibi.invokeAddon(id, method, input)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    notify: setNotice,
    error: (error) =>
      setError(error instanceof Error ? error.message : 'addon failed.'),
  })
  useEffect(() => {
    localStorage.setItem('sidebar-open', String(sidebarOpen))
  }, [sidebarOpen])
  useEffect(() => window.hibi.onWorkspaceChanged(setWorkspace), [])
  useEffect(() => {
    void window.hibi.getWorkspace().then(setWorkspace)
  }, [])
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
      !(target instanceof HTMLElement) ||
      !target.closest('[contenteditable="true"]')
    )
      return
    if (!workspace && sidebarOpen) setSidebarOpen(false)
    if (!hideTitlebar) return
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

  const runCommand = useCallback(
    async (command: DocumentCommand) => {
      if (busyRef.current || dialogs.isOpen()) return false
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
          setWorkspace(await window.hibi.getWorkspace())
        }
        return Boolean(next)
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'could not complete file operation.',
        )
        return false
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [dialogs],
  )

  async function openFolder(): Promise<WorkspaceState | null> {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await window.hibi.openWorkspace()
      if (next) {
        setWorkspace(next)
        setSidebarOpen(true)
        setSettingsOpen(false)
      }
      return next
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'could not open workspace.',
      )
      return null
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function openFile(path: string): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await window.hibi.openWorkspaceFile(path)
      if (next) {
        setDocument(next)
        savedText.current = next.savedMarkdown
        setSettingsOpen(false)
        setWorkspace(await window.hibi.getWorkspace())
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'could not open file.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function refreshFiles() {
    try {
      setWorkspace(await window.hibi.refreshWorkspace())
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'could not refresh workspace.',
      )
    }
  }

  async function renameFile(name: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      setDocument(await window.hibi.renameDocument(name))
      setWorkspace(await window.hibi.refreshWorkspace())
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'could not rename file.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() =>
    window.hibi.onCommand((command) => addonHost.app.runAction(command)),
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

  function runAction(command: AppCommand) {
    if (dialogs.isOpen()) return
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
        void addonHost.app.runCommand(command)
        break
      case 'open-workspace':
        void openFolder()
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
      run: () => addonHost.app.runAction(id),
    }))
  paletteCommands.push(
    ...addonHost.commands.map((command) => ({
      id: command.id,
      label: command.label,
      category: 'addons' as const,
      run: () => {
        void command.run()
      },
    })),
  )

  return (
    <div
      className="app"
      style={{ '--sidebar-width': `${sidebarResize.width}px` } as CSSProperties}
      data-platform={info?.platform}
      data-screen={settingsOpen ? 'settings' : 'editor'}
      data-typing={typing}
      data-sidebar={sidebarOpen}
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
        busy={busy}
        onRename={renameFile}
        sidebarOpen={sidebarOpen}
        onSidebar={() => setSidebarOpen(!sidebarOpen)}
        hotkeys={hotkeys}
        platform={info?.platform ?? 'darwin'}
        document={document}
        settingsOpen={settingsOpen}
        onSettings={() => addonHost.app.runAction('settings')}
        onPalette={() => addonHost.app.runAction('palette')}
        mode={mode}
        onMode={(view) => addonHost.app.runAction(view)}
        onCommand={(command) => void addonHost.app.runCommand(command)}
        disabled={!document}
      />
      {paletteOpen && (
        <CommandPalette
          platform={info?.platform ?? 'darwin'}
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <div className="notification-stack">
        <div
          className="notification error-message"
          role="alert"
          hidden={!error}
          inert={!error}
        >
          <span>{error}</span>
          <IconButton
            type="button"
            aria-label="dismiss error"
            onClick={() => setError('')}
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
        <div
          className="notification notice-message"
          role="status"
          hidden={!notice}
          inert={!notice}
        >
          <span>{notice}</span>
          <IconButton
            type="button"
            aria-label="dismiss notice"
            onClick={() => setNotice('')}
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <WorkspaceSidebar
        resize={sidebarResize}
        open={sidebarOpen && !settingsOpen}
        workspace={workspace}
        onOpen={() => addonHost.app.runAction('open-workspace')}
        onFile={(path) => void openFile(path)}
        onRefresh={() => void refreshFiles()}
        commands={addonHost.commands}
      />
      <SettingsScreen
        showLineNumbers={showLineNumbers}
        onShowLineNumbers={setShowLineNumbers}
        cursorSettings={cursorSettings}
        onCursorSettings={setCursorSettings}
        resize={sidebarResize}
        addonStates={addonHost.states}
        onAddonEnabled={addonHost.setEnabled}
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
            sourceExtensions={addonHost.sourceExtensions}
            richExtensions={addonHost.richExtensions}
            documentRevision={document.revision}
            showLineNumbers={showLineNumbers}
            cursorSettings={cursorSettings}
            markdownExtensions={addonHost.markdownExtensions}
            key={`${document.revision}-${resetEditor}`}
            value={document.markdown}
            onChange={updateMarkdown}
            mode={mode}
            disabled={busy}
            findOpen={findOpen && !settingsOpen}
            onCloseFind={() => setFindOpen(false)}
          />
        )}
        {!settingsOpen && (
          <StatusBar
            items={addonHost.statusItems.filter(
              (item) =>
                item.label && (item.when !== 'source' || mode !== 'normal'),
            )}
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
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </StrictMode>,
)
