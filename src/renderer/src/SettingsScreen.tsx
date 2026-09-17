import { ArrowLeft, CircleX, Puzzle, Search } from 'lucide-react'
import {
  Component,
  type ReactNode,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { AddonState } from '../../addons/api'
import type { AppInfo } from '../../shared/desktop'
import { type DocumentView, isDocumentView } from '../../shared/document-types'
import { actions, type Hotkeys } from '../../shared/hotkeys'
import { ColorschemeSettings } from '../../ui/ColorschemeSettings'
import {
  Button,
  IconButton,
  Select,
  SettingRow,
  Slider,
  TextInput,
  Toggle,
} from '../../ui/Controls'
import { DocumentNotice } from '../../ui/DocumentNotice'
import { Sidebar, type SidebarItem, type SidebarProps } from '../../ui/Sidebar'
import { SettingsDiscovery, settingsIndex } from '../../ui/settings-index'
import { uiCase } from '../../ui/ui-case'
import { AddonMetadata, AddonSettings } from './AddonSettings'
import { AutosaveSettings } from './AutosaveSettings'
import { addons } from './addons'
import { CodeSyntaxSettings } from './CodeSyntaxSettings'
import { colorschemes } from './colorschemes'
import type { CursorSettings } from './EditorCursor'
import { ToolbarSettings } from './EditorToolbar'
import { FormatsSettings } from './FormatsSettings'
import { HibiSettings } from './HibiSettings'
import { HotkeySettings } from './HotkeySettings'
import { NotificationSettings } from './NotificationSettings'
import { SyntaxSettings } from './SyntaxSettings'
import { settingsCategories } from './settings-categories'

class PluginSettingsBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <DocumentNotice
        title="Settings unavailable"
        message="These plugin settings could not load."
      >
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Retry
        </button>
      </DocumentNotice>
    ) : (
      this.props.children
    )
  }
}

export function SettingsScreen({
  discover,
  selected,
  onCategory,
  onSetting,
  onBack,
  open,
  padding,
  onPadding,
  hideTitlebar,
  onHideTitlebar,
  info,
  hotkeys,
  onHotkeys,
  addonStates,
  onAddonEnabled,
  onInstallAddon,
  onRemoveAddon,
  resize,
  cursorSettings,
  onCursorSettings,
  showLineNumbers,
  onShowLineNumbers,
  spellCheck,
  onSpellCheck,
  focusOutlines,
  onFocusOutlines,
  defaultView,
  onDefaultView,
  tabsEnabled,
  tabsBusy,
  onTabsEnabled,
}: {
  discover: boolean
  selected: string
  onCategory: (category: string) => void
  onSetting: (category: string, id: string) => void
  onBack: () => void
  open: boolean
  padding: number
  onPadding: (padding: number) => void
  hideTitlebar: boolean
  onHideTitlebar: (hide: boolean) => void
  info: AppInfo | null
  hotkeys: Hotkeys
  onHotkeys: (hotkeys: Hotkeys) => void
  addonStates: AddonState[]
  onAddonEnabled: (id: string, enabled: boolean) => Promise<void>
  onInstallAddon: (url?: string) => Promise<void>
  onRemoveAddon: (id: string) => Promise<void>
  resize: NonNullable<SidebarProps['resize']>
  cursorSettings: CursorSettings
  onCursorSettings: (settings: CursorSettings) => void
  showLineNumbers: boolean
  onShowLineNumbers: (show: boolean) => void
  spellCheck: boolean
  onSpellCheck: (enabled: boolean) => void
  focusOutlines: boolean
  onFocusOutlines: (enabled: boolean) => void
  defaultView: DocumentView
  onDefaultView: (view: DocumentView) => void
  tabsEnabled: boolean
  tabsBusy: boolean
  onTabsEnabled: (enabled: boolean) => void
}) {
  const screen = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [searchSelection, setSearchSelection] = useState<string | null>(null)
  const indexed = useSyncExternalStore(
    settingsIndex.subscribe,
    settingsIndex.snapshot,
  )
  const searchable = [
    ...indexed,
    ...actions.map(({ id, label, category }) => ({
      id: `hotkey-${id}`,
      label,
      category: 'hotkeys',
      keywords: category,
    })),
  ]
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const searching = terms.length > 0
  useLayoutEffect(() => {
    if (!open) return
    const target =
      screen.current?.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      ) ?? search.current
    target?.focus({ preventScroll: true })
  }, [open])
  const casing = useSyncExternalStore(uiCase.subscribe, uiCase.snapshot)
  const pluginPages = addons.filter(
    (addon) =>
      (!!addon.manifest.fileExtensions?.length || addon.Settings) &&
      addonStates.some(
        (state) => state.id === addon.manifest.id && state.enabled,
      ),
  )
  const items: SidebarItem[] = [
    ...settingsCategories,
    ...pluginPages.map(({ manifest }, index) => ({
      id: `plugin-${manifest.id}`,
      label: manifest.name,
      icon: Puzzle,
      ...(index === 0 ? { section: 'plugins' } : {}),
    })),
  ]
  const category = items.some((item) => item.id === selected)
    ? selected
    : selected.startsWith('plugin-')
      ? 'addons'
      : 'hibi'
  const matches = (text: string) =>
    terms.every((term) => text.toLocaleLowerCase().includes(term))
  const results = searching
    ? items.flatMap(({ section: _section, ...item }) => {
        const children = searchable
          .filter(
            (setting) =>
              setting.category === item.id &&
              matches(`${item.label} ${setting.label} ${setting.keywords}`),
          )
          .map((setting) => ({
            id: `setting:${setting.category}:${setting.id}`,
            label: setting.label,
          }))
        return matches(item.label) || children.length
          ? [{ ...item, ...(children.length ? { children } : {}) }]
          : []
      })
    : []
  const selectResult = (id: string) => {
    setSearchSelection(id)
    const setting = searchable.find(
      (setting) => `setting:${setting.category}:${setting.id}` === id,
    )
    if (setting) onSetting(setting.category, setting.id)
    else onCategory(id)
  }

  return (
    <SettingsDiscovery value={true}>
      <main
        ref={screen}
        className="settings-screen"
        aria-label="Settings"
        hidden={!open}
        inert={!open}
      >
        <Sidebar
          resize={resize}
          className={`settings-sidebar${searching ? ' settings-searching' : ''}`}
          items={searching ? results : items}
          selected={searching ? (searchSelection ?? category) : category}
          onSelect={searching ? selectResult : onCategory}
          label={searching ? 'Settings search results' : 'Settings categories'}
          mode={searching ? 'tree' : 'tabs'}
          collapsible={false}
          empty={<p className="settings-search-empty">No matching settings.</p>}
          idPrefix="category"
          panelPrefix="settings-"
          header={
            <>
              <div className="sidebar-items">
                <button type="button" onClick={onBack}>
                  <ArrowLeft size={16} aria-hidden />
                  <span className="sidebar-label">Back to app</span>
                </button>
              </div>
              <search className="settings-search" aria-label="Settings">
                <Search size={16} aria-hidden />
                <TextInput
                  ref={search}
                  aria-label="Search settings"
                  placeholder="Search settings…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && query) {
                      event.preventDefault()
                      event.stopPropagation()
                      setQuery('')
                    } else if (event.key === 'ArrowDown' && searching) {
                      event.preventDefault()
                      screen.current
                        ?.querySelector<HTMLElement>('[role="treeitem"]')
                        ?.focus()
                    }
                  }}
                />
                {query && (
                  <IconButton
                    aria-label="Clear settings search"
                    onClick={() => {
                      setQuery('')
                      search.current?.focus()
                    }}
                  >
                    <CircleX size={16} aria-hidden />
                  </IconButton>
                )}
              </search>
            </>
          }
          footer={
            info && (
              <div className="settings-versions">
                <span>Hibi {info.version}</span>
                <span>Electron {info.electron}</span>
              </div>
            )
          }
        />
        <div className="settings-content">
          <section
            id="settings-hibi"
            role="tabpanel"
            aria-labelledby="category-hibi"
            aria-label="Hibi"
            hidden={category !== 'hibi'}
          >
            {(discover || (open && (category === 'hibi' || searching))) && (
              <HibiSettings info={info} />
            )}
          </section>
          <section
            id="settings-editor"
            role="tabpanel"
            aria-labelledby="category-editor"
            aria-label="Editor"
            hidden={category !== 'editor'}
          >
            <h1>Editor</h1>
            <h2>Documents</h2>
            <div className="settings-group">
              <SettingRow
                id="document-tabs"
                label="Use tabs"
                description="Open documents in separate tabs. Turn off to work with one file at a time."
              >
                <Toggle
                  id="document-tabs"
                  aria-describedby="document-tabs-description"
                  checked={tabsEnabled}
                  aria-disabled={tabsBusy}
                  onChange={(event) => {
                    if (!tabsBusy) onTabsEnabled(event.target.checked)
                  }}
                />
              </SettingRow>
            </div>
            <h2>Writing</h2>
            <div className="settings-group">
              <SettingRow
                id="spell-check"
                label="Spell check"
                description="Underline possible spelling mistakes in rich text."
              >
                <Toggle
                  id="spell-check"
                  aria-describedby="spell-check-description"
                  checked={spellCheck}
                  onChange={(event) => onSpellCheck(event.target.checked)}
                />
              </SettingRow>
            </div>
            <AutosaveSettings />
            <h2>Layout</h2>
            <div className="settings-group">
              <SettingRow
                id="default-view"
                label="Default view"
                description="Start in this view. Formats fall back to a supported view."
              >
                <Select
                  id="default-view"
                  aria-describedby="default-view-description"
                  value={defaultView}
                  onChange={(event) => {
                    const view = event.target.value
                    if (isDocumentView(view)) onDefaultView(view)
                  }}
                >
                  <option value="normal">Normal</option>
                  <option value="side-by-side">Side-by-side</option>
                  <option value="markdown">Source only</option>
                </Select>
              </SettingRow>
              <SettingRow
                id="editor-padding"
                label="Content padding"
                description="Space around your document in every view."
              >
                <div className="setting-controls">
                  <div className="padding-control">
                    <Slider
                      id="editor-padding"
                      aria-describedby="editor-padding-description"
                      min="0"
                      max="96"
                      step="4"
                      value={padding}
                      onChange={(event) =>
                        onPadding(Number(event.target.value))
                      }
                    />
                    <output htmlFor="editor-padding">{padding} px</output>
                  </div>
                  <Button type="button" onClick={() => onPadding(48)}>
                    Reset to 48 px
                  </Button>
                </div>
              </SettingRow>
              <SettingRow
                id="line-numbers"
                label="Show line numbers"
                description="Number each line in Markdown and side-by-side views."
              >
                <Toggle
                  id="line-numbers"
                  aria-describedby="line-numbers-description"
                  checked={showLineNumbers}
                  onChange={(event) => onShowLineNumbers(event.target.checked)}
                />
              </SettingRow>
            </div>
          </section>
          <section
            id="settings-syntax"
            role="tabpanel"
            aria-labelledby="category-syntax"
            aria-label="Syntax"
            hidden={category !== 'syntax'}
          >
            <SyntaxSettings />
          </section>
          <section
            id="settings-code-syntax"
            role="tabpanel"
            aria-labelledby="category-code-syntax"
            aria-label="Code highlighting"
            hidden={category !== 'code-syntax'}
          >
            <CodeSyntaxSettings />
          </section>
          <section
            id="settings-appearance"
            role="tabpanel"
            aria-labelledby="category-appearance"
            aria-label="Appearance"
            hidden={category !== 'appearance'}
          >
            <h1>Appearance</h1>
            <h2>Interface text</h2>
            <div className="settings-group">
              <SettingRow
                id="lowercase-interface"
                label="Lowercase interface"
                description="Display interface text in lowercase. Your documents and typed values keep their original spelling."
              >
                <Toggle
                  id="lowercase-interface"
                  checked={casing === 'lowercase'}
                  onChange={(event) =>
                    uiCase.set(event.target.checked ? 'lowercase' : 'sentence')
                  }
                />
              </SettingRow>
            </div>
            <h2>Focus</h2>
            <div className="settings-group">
              <SettingRow
                id="focus-outlines"
                label="Non-input focus outlines"
                description="Show outlines on focused buttons, links, and navigation. Input fields keep their focus indicators."
              >
                <Toggle
                  id="focus-outlines"
                  checked={focusOutlines}
                  onChange={(event) => onFocusOutlines(event.target.checked)}
                />
              </SettingRow>
            </div>
            <h2>Colors</h2>
            <ColorschemeSettings store={colorschemes} showLicense={false} />
            <h2>Cursor</h2>
            <div className="settings-group">
              {(
                [
                  [
                    'style',
                    'cursor style',
                    'shape of the text insertion cursor.',
                    [
                      ['bar', 'line |'],
                      ['outline', 'outline ▯'],
                      ['block', 'filled ▮'],
                      ['underline', 'underline _'],
                    ],
                  ],
                  [
                    'speed',
                    'cursor blink',
                    'how quickly the cursor blinks.',
                    [
                      ['fast', 'fast'],
                      ['normal', 'normal'],
                      ['slow', 'slow'],
                    ],
                  ],
                  [
                    'animation',
                    'cursor animation',
                    'smooth fades and slides; blink moves instantly.',
                    [
                      ['smooth', 'smooth'],
                      ['blink', 'blink'],
                    ],
                  ],
                ] as const
              ).map(([key, label, description, options]) => (
                <SettingRow
                  key={key}
                  id={`cursor-${key}`}
                  label={label}
                  description={description}
                >
                  <Select
                    id={`cursor-${key}`}
                    aria-describedby={`cursor-${key}-description`}
                    value={cursorSettings[key]}
                    onChange={(event) =>
                      onCursorSettings({
                        ...cursorSettings,
                        [key]: event.target.value,
                      })
                    }
                  >
                    {options.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
              ))}
            </div>
            <h2>Window</h2>
            <div className="settings-group">
              <SettingRow
                id="hide-titlebar"
                label="Hide top bar while typing"
                description="Show it after a pause, or move your pointer to the top."
              >
                <Toggle
                  id="hide-titlebar"
                  aria-describedby="hide-titlebar-description"
                  checked={hideTitlebar}
                  onChange={(event) => onHideTitlebar(event.target.checked)}
                />
              </SettingRow>
            </div>
            <ToolbarSettings />
            <NotificationSettings />
          </section>
          <section
            id="settings-hotkeys"
            role="tabpanel"
            aria-labelledby="category-hotkeys"
            aria-label="Hotkeys"
            hidden={category !== 'hotkeys'}
          >
            {category === 'hotkeys' && (
              <HotkeySettings
                active={open}
                hotkeys={hotkeys}
                onChange={onHotkeys}
                platform={info?.platform ?? 'darwin'}
              />
            )}
          </section>
          <section
            id="settings-addons"
            role="tabpanel"
            aria-labelledby="category-addons"
            aria-label="Addons"
            hidden={category !== 'addons'}
          >
            <AddonSettings
              addons={addons}
              states={addonStates}
              setEnabled={onAddonEnabled}
              install={onInstallAddon}
              remove={onRemoveAddon}
            />
          </section>
          <section
            id="settings-formats"
            role="tabpanel"
            aria-labelledby="category-formats"
            aria-label="Formats"
            hidden={category !== 'formats'}
          >
            <FormatsSettings
              active={open && category === 'formats'}
              addons={addons}
              states={addonStates}
              setEnabled={onAddonEnabled}
              open={onCategory}
            />
          </section>
          {pluginPages.map(({ manifest, Settings }) => (
            <section
              key={manifest.id}
              id={`settings-plugin-${manifest.id}`}
              role="tabpanel"
              aria-labelledby={`category-plugin-${manifest.id}`}
              aria-label={manifest.name}
              hidden={category !== `plugin-${manifest.id}`}
            >
              <h1>{manifest.name}</h1>
              <p className="plugin-description">
                {manifest.description}
                <AddonMetadata manifest={manifest} />
              </p>
              {!!manifest.fileExtensions?.length && (
                <>
                  <h2>Format</h2>
                  <div className="settings-group">
                    <SettingRow
                      id={`plugin-format-${manifest.id}`}
                      label="Enable format"
                      description={manifest.fileExtensions
                        .map((extension) => `.${extension}`)
                        .join(' · ')}
                    >
                      {manifest.id === 'markdown' ? (
                        <span className="setting-availability">
                          Always available
                        </span>
                      ) : (
                        <Toggle
                          id={`plugin-format-${manifest.id}`}
                          checked={addonStates.some(
                            (state) =>
                              state.id === manifest.id && state.enabled,
                          )}
                          onChange={(event) =>
                            void onAddonEnabled(
                              manifest.id,
                              event.target.checked,
                            )
                          }
                        />
                      )}
                    </SettingRow>
                    <SettingRow
                      id={`plugin-controls-${manifest.id}`}
                      label="Rendering and highlighting"
                      description="Configure syntax features and source colors."
                    >
                      <Button onClick={() => onCategory('syntax')}>
                        Syntax
                      </Button>
                      <Button onClick={() => onCategory('code-syntax')}>
                        Code highlighting
                      </Button>
                    </SettingRow>
                  </div>
                </>
              )}
              {Settings &&
                (discover ||
                  (open &&
                    (searching || category === `plugin-${manifest.id}`))) && (
                  <PluginSettingsBoundary key={manifest.id}>
                    <Suspense
                      fallback={
                        <DocumentNotice title="Loading settings…" busy />
                      }
                    >
                      <Settings />
                    </Suspense>
                  </PluginSettingsBoundary>
                )}
            </section>
          ))}
        </div>
      </main>
    </SettingsDiscovery>
  )
}
