import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import { DialogProvider, useDialogs } from '../../ui/DialogProvider'
import { MenuHost } from '../../ui/MenuHost'
import { ToastProvider, useToasts } from '../../ui/Sonner'
import type { ToastHandle } from '../../ui/toasts'
import './styles.css'
import type {
  WorkspaceAction,
  WorkspaceActionResult,
  WorkspaceState,
} from '../../shared/workspace'
import { settingsIndex } from '../../ui/settings-index'
import { useSidebarResize } from '../../ui/useSidebarResize'
import { addonRegistry } from './addon-registry'
import { addons, useAddons } from './addons'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { colorschemes } from './colorschemes'
import { MarkdownEditor, type ViewMode } from './Editor'
import { loadCursor } from './EditorCursor'
import { EditorToolbar } from './EditorToolbar'
import { FlavorPicker } from './FlavorPicker'
import {
  automaticFlavor,
  type FlavorChoice,
  flavorMatches,
  flavors,
  loadFlavor,
  selectedFlavors,
} from './flavors'
import { LoadingScreen } from './LoadingScreen'
import { projectMarkdown } from './markdown'
import { SettingsScreen, settingsCategories } from './SettingsScreen'
import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'
import { toolbar } from './toolbar'
import { VersionHistory } from './VersionHistory'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { type WorkspaceRename, workspaceMenuItems } from './workspace-menu'

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
  const [settingsCategory, setSettingsCategory] = useState('hibi')
  const [settingTarget, setSettingTarget] = useState<string | null>(null)
  const indexedSettings = useSyncExternalStore(
    settingsIndex.subscribe,
    settingsIndex.snapshot,
  )
  const themeSnapshot = useSyncExternalStore(
    colorschemes.subscribe,
    colorschemes.snapshot,
  )
  const toolbarSnapshot = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.snapshot,
  )
  useEffect(() => {
    if (!settingTarget) return
    const target = window.document.getElementById(settingTarget)
    const row = target?.closest('.setting-row') ?? target
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target?.focus({ preventScroll: true })
    setSettingTarget(null)
  }, [settingTarget])
  const dialogs = useDialogs()
  const toasts = useToasts()
  const errorNotice = useRef<ToastHandle | null>(null)
  const setError = useCallback(
    (message: string) => {
      errorNotice.current?.dismiss()
      errorNotice.current = message
        ? toasts.show({ message, variant: 'error' })
        : null
    },
    [toasts],
  )
  const setNotice = useCallback(
    (message: string) => {
      if (message) toasts.show({ message })
    },
    [toasts],
  )
  const [document, setDocument] = useState<DocumentState | null>(null)
  const currentDocument = useRef(document)
  currentDocument.current = document
  const acceptDocument = useCallback((next: DocumentState) => {
    const previous = currentDocument.current
    if (
      previous &&
      previous.id !== next.id &&
      previous.revision === next.revision
    ) {
      const choice = localStorage.getItem(`hibi:flavor:${previous.id}`)
      if (choice) localStorage.setItem(`hibi:flavor:${next.id}`, choice)
    }
    currentDocument.current = next
    setDocument(next)
  }, [])
  const availableFlavors = useSyncExternalStore(
    flavors.subscribe,
    flavors.snapshot,
  )
  const [flavorOverride, setFlavorOverride] = useState<{
    id: string
    choice: FlavorChoice
  } | null>(null)
  const flavorChoice = useMemo(
    () =>
      flavorOverride && flavorOverride.id === document?.id
        ? flavorOverride.choice
        : loadFlavor(document?.id),
    [flavorOverride, document?.id],
  )
  const flavorIds = selectedFlavors(flavorChoice, availableFlavors)
    .map((flavor) => flavor.id)
    .join(',')
  const chosenFlavors = useMemo(
    () =>
      availableFlavors.filter((flavor) =>
        flavorIds.split(',').includes(flavor.id),
      ),
    [flavorIds, availableFlavors],
  )
  const [resetEditor, setResetEditor] = useState(0)
  const savedText = useRef('')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<ViewMode>('normal')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [typing, setTyping] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [workspaceRename, setWorkspaceRename] = useState<WorkspaceRename>(null)
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
      snapshot: () => window.hibi.getWorkspaceSnapshot(),
      get: () => window.hibi.getWorkspace(),
      open: openFolder,
      openFile: openFile,
    },
    invoke: async (id, method, input) => {
      if (busyRef.current) throw new Error('another operation is in progress.')
      busyRef.current = true
      setBusy(true)
      try {
        const result = await window.hibi.invokeAddon(id, method, input)
        const next = await window.hibi.getDocument()
        if (next.revision !== document?.revision) {
          acceptDocument(next)
          savedText.current = next.savedMarkdown
        }
        setWorkspace(await window.hibi.getWorkspace())
        return result
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
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
    clearTimeout(typingTimer.current)
    setTyping(true)
    typingTimer.current = setTimeout(() => setTyping(false), 1200)
  }

  function openPalette() {
    showTitlebar()
    setPaletteOpen(true)
  }

  function toggleSettings() {
    const previousFocus = window.document.activeElement
    showTitlebar()
    if (!settingsOpen) setFindOpen(false)
    setSettingsOpen(!settingsOpen)
    if (settingsOpen)
      requestAnimationFrame(() => {
        // A click into either pane wins over this deferred focus restoration.
        const active = window.document.activeElement
        if (active !== previousFocus && active !== window.document.body) return
        window.document
          .querySelector<HTMLElement>(
            mode === 'markdown' ? '.cm-content' : '.tiptap',
          )
          ?.focus()
      })
  }

  function openSetting(category: string, id?: string) {
    showTitlebar()
    setFindOpen(false)
    setSettingsCategory(category)
    setSettingsOpen(true)
    setSettingTarget(id ?? null)
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
          acceptDocument(document)
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
  }, [acceptDocument])

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
          acceptDocument(next)
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
    [dialogs, acceptDocument, setError],
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
        setWorkspaceRename(null)
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
        acceptDocument(next)
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
      acceptDocument(await window.hibi.renameDocument(name))
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

  useEffect(() => window.hibi.onNotice(setNotice), [setNotice])

  function updateMarkdown(markdown: string) {
    if (new TextEncoder().encode(markdown).length > MAX_DOCUMENT_BYTES) {
      setError('documents must stay under 2 mib. this edit was not applied.')
      setResetEditor((value) => value + 1)
      return
    }
    setDocument((current) =>
      current
        ? {
            ...current,
            markdown,
            dirty: markdown !== savedText.current || current.ephemeral,
          }
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

  async function runWorkspaceAction(
    action: WorkspaceAction,
  ): Promise<WorkspaceActionResult | null> {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)
    try {
      const result = await window.hibi.workspaceAction(action)
      if (result) {
        setWorkspace(result.workspace)
        acceptDocument(result.document)
        savedText.current = result.document.savedMarkdown
        if (action.action === 'new-file') setSettingsOpen(false)
        if (action.action === 'new-file' || action.action === 'new-folder') {
          setSidebarOpen(true)
          setSettingsOpen(false)
          setWorkspaceRename({
            id: result.path,
            value: result.path.split('/').at(-1) ?? '',
          })
        }
      }
      return result
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function runAction(command: AppCommand) {
    if (dialogs.isOpen()) return
    if (command === 'palette') {
      openPalette()
      return
    }
    setPaletteOpen(false)
    switch (command) {
      case 'history':
        void dialogs
          .open<string>({
            title: 'version history',
            size: 'wide',
            description:
              'local snapshots on save. restoring changes the editor; save to replace the file.',
            content: ({ close }) => <VersionHistory close={close} />,
          })
          .result.then(async (id) => {
            if (!id || busyRef.current) return
            busyRef.current = true
            setBusy(true)
            try {
              const next = await window.hibi.restoreVersion(id)
              if (!next) return
              acceptDocument(next)
              savedText.current = next.savedMarkdown
              setSettingsOpen(false)
            } catch (error) {
              setError(String(error))
            } finally {
              busyRef.current = false
              setBusy(false)
            }
          })
        break
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
      case 'toggle-sidebar':
        setSidebarOpen((open) => !open)
        break
      case 'install-addon':
        void addonHost.install()
        break
    }
  }

  const knownFlavors = useMemo(
    () => [
      ...addonHost.catalog.flatMap((addon) =>
        (addon.flavors ?? []).map((flavor) => ({
          ...flavor,
          id: `${addon.manifest.id}.${flavor.id}`,
          addonId: addon.manifest.id,
        })),
      ),
      ...availableFlavors.filter(
        (flavor) =>
          !addonHost.catalog.some((addon) =>
            addon.flavors?.some(
              (known) => `${addon.manifest.id}.${known.id}` === flavor.id,
            ),
          ),
      ),
    ],
    [addonHost.catalog, availableFlavors],
  )
  const flavorSource = useMemo(
    () =>
      projectMarkdown(document?.markdown ?? '', addonHost.markdownExtensions)
        .content,
    [document?.markdown, addonHost.markdownExtensions],
  )
  const detectedFlavors = useMemo(
    () => knownFlavors.filter((flavor) => flavorMatches(flavor, flavorSource)),
    [knownFlavors, flavorSource],
  )
  const unsupportedFlavor = detectedFlavors.some(
    (flavor) => !chosenFlavors.some((chosen) => chosen.id === flavor.id),
  )
  const flavorLabel = [
    (flavorChoice.dialect === 'auto'
      ? detectedFlavors.find((flavor) => flavor.kind === 'dialect')?.name
      : chosenFlavors.find((flavor) => flavor.kind === 'dialect')?.name) ??
      'markdown',
    ...detectedFlavors
      .filter((flavor) => flavor.kind === 'syntax')
      .map((flavor) => flavor.name),
  ].join(' + ')
  function changeFlavor(choice: FlavorChoice) {
    if (!document) return
    localStorage.setItem(`hibi:flavor:${document.id}`, JSON.stringify(choice))
    setFlavorOverride({ id: document.id, choice })
  }
  function openFlavors() {
    dialogs.open({
      title: 'markdown flavor',
      description:
        'choose this file’s dialect and extra syntax. automatic detection recognizes enabled features.',
      content: () => (
        <FlavorPicker
          initial={flavorChoice}
          known={knownFlavors}
          onChange={changeFlavor}
          onEnable={(id) => addonHost.setEnabled(id, true)}
        />
      ),
    })
  }

  if ((!document || !addonHost.ready) && !failed) return <LoadingScreen full />

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
    {
      id: 'settings.licenses',
      category: 'settings',
      label: 'open source licenses',
      run: () => openSetting('hibi', 'open-source-licenses'),
    },
    ...actions.map(({ id, label }) => ({
      id: `shortcut.${id}`,
      category: 'settings' as const,
      label: `shortcut: ${label}`,
      keywords: 'keyboard hotkeys rebind',
      run: () => openSetting('hotkeys', `hotkey-${id}`),
    })),
    {
      id: 'flavor.choose',
      category: 'edit',
      label: 'change markdown flavor…',
      run: openFlavors,
    },
    {
      id: 'flavor.auto',
      category: 'edit',
      label: 'automatically detect markdown flavor',
      run: () => changeFlavor(automaticFlavor),
    },
    {
      id: 'flavor.markdown',
      category: 'edit',
      label: 'use plain markdown flavor',
      run: () => changeFlavor({ dialect: 'markdown', syntax: [] }),
    },
    ...availableFlavors.map((flavor) => ({
      id: `flavor.${flavor.id}`,
      category: 'edit' as const,
      label: `use ${flavor.name} flavor`,
      keywords: flavor.description,
      run: () =>
        changeFlavor(
          flavor.kind === 'dialect'
            ? { ...flavorChoice, dialect: flavor.id }
            : {
                ...flavorChoice,
                syntax: [
                  ...new Set([
                    ...(flavorChoice.syntax === 'auto'
                      ? availableFlavors
                          .filter((entry) => entry.kind === 'syntax')
                          .map((entry) => entry.id)
                      : flavorChoice.syntax),
                    flavor.id,
                  ]),
                ],
              },
        ),
    })),
    ...settingsCategories.map(({ id, label }) => ({
      id: `settings.${id}`,
      category: 'settings' as const,
      label: `open ${label} settings`,
      run: () => openSetting(id),
    })),
    ...indexedSettings
      .filter((setting) => !setting.id.startsWith('addon-'))
      .map((setting) => ({
        id: `setting.${setting.id}`,
        category: 'settings' as const,
        label: setting.label,
        keywords: `${setting.category} ${setting.keywords}`,
        run: () => openSetting(setting.category, setting.id),
      })),
    ...addons.flatMap(({ manifest, Settings }) => {
      const enabled = addonHost.states.some(
        (state) => state.id === manifest.id && state.enabled,
      )
      return [
        {
          id: `addon.toggle.${manifest.id}`,
          category:
            manifest.kind === 'theme'
              ? ('themes' as const)
              : ('extensions' as const),
          label: `${enabled ? 'disable' : 'enable'} ${manifest.name}`,
          keywords: manifest.description,
          run: () => {
            void addonHost.setEnabled(manifest.id, !enabled)
          },
        },
        ...(Settings && enabled
          ? [
              {
                id: `addon.settings.${manifest.id}`,
                category: 'settings' as const,
                label: `${manifest.name} settings`,
                keywords: manifest.description,
                run: () => openSetting(`plugin-${manifest.id}`),
              },
            ]
          : []),
        ...(addonRegistry.isInstalled(manifest.id)
          ? [
              {
                id: `addon.remove.${manifest.id}`,
                category: 'extensions' as const,
                label: `remove ${manifest.name}`,
                run: () => {
                  void addonHost.remove(manifest.id)
                },
              },
            ]
          : []),
      ]
    }),
    ...themeSnapshot.schemes.map((scheme) => ({
      id: `theme.${scheme.id}`,
      category: 'themes' as const,
      label: scheme.name,
      keywords: `${scheme.appearance} ${scheme.author}`,
      run: () =>
        colorschemes.set({
          mode: scheme.appearance,
          [scheme.appearance]: scheme.id,
        }),
    })),
    ...toolbarSnapshot.items
      .filter(
        (item) =>
          !item.disabled &&
          !item.hidden &&
          (!item.when ||
            (item.when === 'normal' ? mode !== 'markdown' : mode !== 'normal')),
      )
      .map((item) => ({
        id: `toolbar.${item.id}`,
        category: 'format' as const,
        label: item.label,
        run: () => {
          void item.onClick()
        },
      })),
    {
      id: 'toolbar.toggle',
      category: 'view',
      label: toolbarSnapshot.preferences.visible
        ? 'hide toolbar'
        : 'show toolbar',
      run: () =>
        toolbar.setPreferences({
          visible: !toolbarSnapshot.preferences.visible,
        }),
    },
    ...addonHost.commands.map((command) => ({
      id: command.id,
      label: command.label,
      category: 'addons' as const,
      keywords: command.keywords ?? '',
      run: () => {
        void command.run()
      },
    })),
  )

  if (workspace && !busy) {
    const create = async (action: 'new-file' | 'new-folder', path = '') => {
      await runWorkspaceAction({ action, path })
    }
    const run = (action: () => void | Promise<void>) => {
      void Promise.resolve()
        .then(action)
        .catch((error: unknown) => setError(String(error)))
    }
    paletteCommands.push(
      {
        id: 'workspace.new-file',
        category: 'file',
        label: 'new workspace file',
        run: () => run(() => create('new-file')),
      },
      {
        id: 'workspace.new-folder',
        category: 'file',
        label: 'new workspace folder',
        run: () => run(() => create('new-folder')),
      },
      {
        id: 'workspace.refresh',
        category: 'file',
        label: 'refresh workspace',
        run: () => void refreshFiles(),
      },
    )
    if (workspace.activePath && document)
      paletteCommands.push(
        ...workspaceMenuItems(
          { path: workspace.activePath, name: document.name, kind: 'file' },
          {
            dialogs,
            onAction: runWorkspaceAction,
            create,
            rename(target) {
              setWorkspaceRename(target)
              setSidebarOpen(true)
              setSettingsOpen(false)
            },
          },
        ).map((item) => ({
          id: `workspace.${item.id}`,
          category: 'file' as const,
          label: `${document.name}: ${item.label}`,
          run: () => run(item.onSelect),
        })),
      )
  } else if (document && !busy)
    paletteCommands.push({
      id: 'document.rename',
      category: 'file',
      label: 'rename document…',
      run: () => {
        void dialogs
          .prompt({
            title: 'rename document',
            label: 'file name',
            defaultValue: document.name,
          })
          .then((name) => {
            if (name !== null) void renameFile(name)
          })
      },
    })

  return (
    <div
      className="app"
      aria-busy={busy}
      style={{ '--sidebar-width': `${sidebarResize.width}px` } as CSSProperties}
      data-platform={info?.platform}
      data-screen={settingsOpen ? 'settings' : 'editor'}
      data-typing={typing && hideTitlebar}
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
        if (event.target.closest('.titlebar, .editor-toolbar')) showTitlebar()
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
      <WorkspaceSidebar
        editing={workspaceRename}
        onEditing={setWorkspaceRename}
        dirty={document?.dirty ?? false}
        onAction={runWorkspaceAction}
        onError={(error) => setError(String(error))}
        resize={sidebarResize}
        open={sidebarOpen && !settingsOpen}
        workspace={workspace}
        onOpen={() => addonHost.app.runAction('open-workspace')}
        onFile={(path) => void openFile(path)}
        onRefresh={() => void refreshFiles()}
        commands={addonHost.commands}
      />
      <MenuHost />
      <SettingsScreen
        onInstallAddon={addonHost.install}
        onRemoveAddon={addonHost.remove}
        selected={settingsCategory}
        onCategory={setSettingsCategory}
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
        <EditorToolbar mode={mode} typing={typing} />
        <div className="editor-page">
          {document && (
            <MarkdownEditor
              flavors={chosenFlavors}
              unsupportedFlavor={unsupportedFlavor}
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
              items={[
                {
                  id: 'flavor',
                  label: flavorLabel,
                  tooltip: unsupportedFlavor
                    ? 'some detected syntax is disabled; choose a flavor or enable its extension'
                    : `${flavorChoice.dialect === 'auto' ? 'detected' : 'selected'} markdown flavor · click to change`,
                  onClick: openFlavors,
                },
                ...addonHost.statusItems.filter(
                  (item) =>
                    item.label && (item.when !== 'source' || mode !== 'normal'),
                ),
              ]}
            />
          )}
        </div>
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
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
