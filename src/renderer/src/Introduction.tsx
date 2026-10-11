import { FileText, FolderOpen } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { AddonState } from '../../addons/api'
import type { DocumentView } from '../../shared/document-types'
import type { AppCommand, Hotkeys } from '../../shared/hotkeys'
import { Button, Select, SettingRow, Toggle } from '../../ui/Controls'
import { Modal } from '../../ui/Modal'
import { ShortcutKeys } from '../../ui/ShortcutKeys'
import { addons } from './addons'
import { colorschemes } from './colorschemes'
import { toolbar } from './toolbar'
import './introduction.css'

const featuredAddons = [
  'slash-commands',
  'word-count',
  'block-drag',
  'review',
  'mermaid',
]
const essentials: { id: AppCommand; label: string }[] = [
  { id: 'palette', label: 'Run any command' },
  { id: 'open', label: 'Open a document' },
  { id: 'toggle-sidebar', label: 'Show or hide the sidebar' },
  { id: 'settings', label: 'Open settings' },
]
const views: { view: DocumentView; label: string }[] = [
  { view: 'normal', label: 'Normal' },
  { view: 'side-by-side', label: 'Side-by-side' },
  { view: 'markdown', label: 'Source view' },
]

/** First-run introduction. Every choice writes the same preference the matching setting uses. */
export function Introduction({
  platform,
  hotkeys,
  defaultView,
  onDefaultView,
  markdownMarkers,
  onMarkdownMarkers,
  spellCheck,
  onSpellCheck,
  tabsEnabled,
  tabsBusy,
  onTabsEnabled,
  addonStates,
  onAddonEnabled,
  onOpenWorkspace,
  onOpenFile,
  onClose,
}: {
  platform: string
  hotkeys: Hotkeys
  defaultView: DocumentView
  onDefaultView: (view: DocumentView) => void
  markdownMarkers: boolean
  onMarkdownMarkers: (shown: boolean) => void
  spellCheck: boolean
  onSpellCheck: (enabled: boolean) => void
  tabsEnabled: boolean
  tabsBusy: boolean
  onTabsEnabled: (enabled: boolean) => void
  addonStates: readonly AddonState[]
  onAddonEnabled: (id: string, enabled: boolean) => void
  onOpenWorkspace: () => Promise<boolean>
  onOpenFile: () => Promise<boolean>
  /** `start` finishes the flow; `skip` leaves the app as it is. */
  onClose: (reason: 'start' | 'skip') => void
}) {
  const [step, setStep] = useState(0)
  const [pending, setPending] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const countId = useId()
  const theme = useSyncExternalStore(
    colorschemes.subscribe,
    colorschemes.snapshot,
  )
  const toolbarVisible = useSyncExternalStore(
    toolbar.subscribe,
    toolbar.snapshot,
  ).preferences.visible
  // biome-ignore lint/correctness/useExhaustiveDependencies: passive effects run after Modal opens the dialog, so each step title takes focus.
  useEffect(() => heading.current?.focus(), [step])

  // One request at a time; navigation waits so a finished open advances from its own step.
  async function run<T>(action: () => Promise<T>) {
    if (pending) return
    setPending(true)
    try {
      return await action()
    } finally {
      setPending(false)
    }
  }
  async function open(action: () => Promise<boolean>) {
    if (await run(action)) setStep((current) => current + 1)
  }

  const scheme = (appearance: 'light' | 'dark') =>
    theme.schemes.find(
      (entry) =>
        entry.id === theme.preferences[appearance] &&
        entry.appearance === appearance,
    ) ?? theme.schemes.find((entry) => entry.appearance === appearance)
  const preview = (appearance: 'light' | 'dark') => {
    const colors = scheme(appearance)?.colors
    return {
      '--preview-background': colors?.background,
      '--preview-surface': colors?.surface,
      '--preview-ink': colors?.ink,
      '--preview-muted': colors?.muted,
      '--preview-accent': colors?.accent,
      '--preview-border': colors?.border,
    } as CSSProperties
  }
  const activeAppearance = theme.active.appearance
  const featured = featuredAddons.flatMap((id) => {
    const addon = addons.find(({ manifest }) => manifest.id === id)
    return addon ? [addon.manifest] : []
  })

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: 'Welcome to Hibi',
      body: (
        <>
          <div className="introduction-hero" aria-hidden="true">
            <p className="introduction-hero-heading">
              <span className="introduction-marker"># </span>Today
            </p>
            <p>
              A fast, quiet page for your notes, kept as{' '}
              <span className="introduction-marker">**</span>
              <strong>plain Markdown</strong>
              <span className="introduction-marker">**</span>
              <span className="introduction-caret" />
            </p>
          </div>
          <p className="introduction-lede">
            Hibi is a fast, customizable writing app that keeps your files
            yours.
          </p>
          <p>
            This takes about a minute. You can skip any step and change these
            choices later in Settings.
          </p>
        </>
      ),
    },
    {
      title: 'Make it yours',
      body: (
        <>
          <p>Choose how Hibi looks. You will see each change right away.</p>
          <fieldset className="introduction-choices">
            <legend className="introduction-legend">Appearance</legend>
            {(
              [
                ['system', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                className="introduction-choice"
                aria-pressed={theme.preferences.mode === mode}
                onClick={() => colorschemes.set({ mode })}
              >
                <span
                  className="introduction-window"
                  data-appearance={mode}
                  aria-hidden="true"
                >
                  {(mode === 'system'
                    ? (['light', 'dark'] as const)
                    : [mode]
                  ).map((appearance) => (
                    <span
                      key={appearance}
                      className="introduction-window-page"
                      style={preview(appearance)}
                    >
                      <span className="introduction-line" data-size="title" />
                      <span className="introduction-line" />
                      <span className="introduction-line" data-size="short" />
                    </span>
                  ))}
                </span>
                {label}
              </Button>
            ))}
          </fieldset>
          <div className="settings-group">
            <SettingRow
              id="introduction-colorscheme"
              label={`${activeAppearance} colorscheme`}
              description="More colorschemes and addon themes are in Appearance settings."
            >
              <Select
                id="introduction-colorscheme"
                aria-describedby="introduction-colorscheme-description"
                value={theme.preferences[activeAppearance]}
                onChange={(event) =>
                  colorschemes.set({ [activeAppearance]: event.target.value })
                }
              >
                {theme.schemes
                  .filter((entry) => entry.appearance === activeAppearance)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </Select>
            </SettingRow>
          </div>
        </>
      ),
    },
    {
      title: 'How you write',
      body: (
        <>
          <p>
            Write with formatting shown, edit the Markdown source, or see both
            side by side. Files open in the view you choose.
          </p>
          <fieldset className="introduction-choices">
            <legend className="introduction-legend">Default view</legend>
            {views.map(({ view, label }) => (
              <Button
                key={view}
                className="introduction-choice"
                aria-pressed={defaultView === view}
                onClick={() => onDefaultView(view)}
              >
                <span
                  className="introduction-window"
                  data-view={view}
                  aria-hidden="true"
                >
                  {view !== 'markdown' && (
                    <span className="introduction-window-page">
                      <span className="introduction-line" data-size="title" />
                      <span className="introduction-line" />
                      <span className="introduction-line" data-size="short" />
                    </span>
                  )}
                  {view !== 'normal' && (
                    <span className="introduction-window-page" data-source>
                      <span className="introduction-source">
                        <span className="introduction-line" />
                      </span>
                      <span className="introduction-line" />
                      <span className="introduction-line" data-size="short" />
                    </span>
                  )}
                </span>
                {label}
              </Button>
            ))}
          </fieldset>
          <div className="settings-group">
            <SettingRow
              id="introduction-markdown-markers"
              label="Show Markdown markers"
              description="Show formatting hints in the active block while editing formatted text."
            >
              <Toggle
                id="introduction-markdown-markers"
                aria-describedby="introduction-markdown-markers-description"
                checked={markdownMarkers}
                onChange={(event) => onMarkdownMarkers(event.target.checked)}
              />
            </SettingRow>
            <SettingRow id="introduction-spell-check" label="Spell check">
              <Toggle
                id="introduction-spell-check"
                checked={spellCheck}
                onChange={(event) => onSpellCheck(event.target.checked)}
              />
            </SettingRow>
            <SettingRow id="introduction-toolbar" label="Show toolbar">
              <Toggle
                id="introduction-toolbar"
                checked={toolbarVisible}
                onChange={(event) =>
                  toolbar.setPreferences({ visible: event.target.checked })
                }
              />
            </SettingRow>
            <SettingRow id="introduction-tabs" label="Use tabs">
              <Toggle
                id="introduction-tabs"
                checked={tabsEnabled}
                aria-disabled={tabsBusy}
                onChange={(event) => {
                  if (!tabsBusy) onTabsEnabled(event.target.checked)
                }}
              />
            </SettingRow>
          </div>
        </>
      ),
    },
    {
      title: 'Your files',
      body: (
        <>
          <p>
            Hibi saves your writing as plain Markdown files in folders you
            choose. You don’t need an account, and your files stay on your
            computer, ready to open in any other app.
          </p>
          <div className="introduction-actions">
            <Button
              variant="row"
              disabled={pending || tabsBusy}
              onClick={() => void open(onOpenWorkspace)}
            >
              <FolderOpen aria-hidden="true" />
              <span>
                <span className="introduction-action-label">
                  Open a folder…
                </span>
                <span className="introduction-action-description">
                  Use a folder as a workspace to browse and link its notes.
                </span>
              </span>
            </Button>
            <Button
              variant="row"
              disabled={pending || tabsBusy}
              onClick={() => void open(onOpenFile)}
            >
              <FileText aria-hidden="true" />
              <span>
                <span className="introduction-action-label">Open a file…</span>
                <span className="introduction-action-description">
                  Edit a single document from anywhere on your computer.
                </span>
              </span>
            </Button>
          </div>
          <p>Or continue to start with a blank page.</p>
        </>
      ),
    },
    {
      title: 'Addons',
      body: (
        <>
          <p>
            Addons add features without slowing down the editor. These run on
            your computer; you can find more in the Addon Manager.
          </p>
          <div className="settings-group">
            {featured.map((manifest) => (
              <SettingRow
                key={manifest.id}
                id={`introduction-addon-${manifest.id}`}
                label={manifest.name}
                description={manifest.description}
              >
                <Toggle
                  id={`introduction-addon-${manifest.id}`}
                  aria-describedby={`introduction-addon-${manifest.id}-description`}
                  checked={addonStates.some(
                    (state) => state.id === manifest.id && state.enabled,
                  )}
                  onChange={(event) =>
                    onAddonEnabled(manifest.id, event.target.checked)
                  }
                />
              </SettingRow>
            ))}
          </div>
        </>
      ),
    },
    {
      title: 'Essentials',
      body: (
        <>
          <p>
            A few shortcuts cover most of Hibi. You can change any of them in
            Hotkeys settings.
          </p>
          <dl className="settings-group introduction-shortcuts">
            {essentials.map(({ id, label }) => (
              <div key={id}>
                <dt>{label}</dt>
                <dd>
                  {hotkeys[id] ? (
                    <ShortcutKeys shortcut={hotkeys[id]} platform={platform} />
                  ) : (
                    <span className="introduction-unbound">No shortcut</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Open the command palette and choose Show introduction to see this
            again.
          </p>
        </>
      ),
    },
  ]
  const position = step + 1
  const total = steps.length
  const last = position === total
  const current = steps[step]!

  return (
    <Modal
      className="app-dialog introduction"
      aria-label="Introduction"
      closeOnOutsideClick={false}
      onDismiss={() => onClose('skip')}
    >
      <div className="introduction-top">
        <span className="introduction-progress" aria-hidden="true">
          {steps.map(({ title }, index) => (
            <span key={title} data-current={index === step || undefined} />
          ))}
        </span>
        <Button variant="ghost" onClick={() => onClose('skip')}>
          Skip
        </Button>
      </div>
      <div className="introduction-step" key={step}>
        <h2 ref={heading} tabIndex={-1} aria-describedby={countId}>
          {current.title}
        </h2>
        <span id={countId} className="introduction-count">
          {`Step ${position} of ${total}`}
        </span>
        {current.body}
      </div>
      <div className="dialog-footer">
        {step > 0 && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        )}
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => (last ? onClose('start') : setStep(step + 1))}
        >
          {last ? 'Start writing' : 'Continue'}
        </Button>
      </div>
    </Modal>
  )
}
