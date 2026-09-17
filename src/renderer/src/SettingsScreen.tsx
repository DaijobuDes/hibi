import {
  ArrowLeft,
  File,
  FileText,
  Keyboard,
  PanelTop,
  Puzzle,
} from 'lucide-react'
import { Component, type ReactNode } from 'react'
import type { AddonManifest, AddonState } from '../../addons/api'
import type { AppInfo } from '../../shared/desktop'
import type { Hotkeys } from '../../shared/hotkeys'
import { ColorschemeSettings } from '../../ui/ColorschemeSettings'
import { Button, Select, SettingRow, Slider, Toggle } from '../../ui/Controls'
import { Sidebar, type SidebarProps } from '../../ui/Sidebar'
import { SettingsDiscovery } from '../../ui/settings-index'
import { addonRegistry } from './addon-registry'
import { addons } from './addons'
import { colorschemes } from './colorschemes'
import type { CursorSettings } from './EditorCursor'
import { ToolbarSettings } from './EditorToolbar'
import { HibiSettings } from './HibiSettings'
import { HotkeySettings } from './HotkeySettings'
import { NotificationSettings } from './NotificationSettings'

export const settingsCategories = [
  { id: 'hibi', label: 'hibi', icon: File },
  { id: 'editor', label: 'editor', icon: FileText },
  { id: 'appearance', label: 'appearance', icon: PanelTop },
  { id: 'hotkeys', label: 'hotkeys', icon: Keyboard },
  { id: 'addons', label: 'addons', icon: Puzzle },
] as const

function AddonMetadata({ manifest }: { manifest: AddonManifest }) {
  return (
    <span className="addon-metadata">
      <span>{manifest.kind ?? 'extension'}</span>
      {manifest.version && <span>v{manifest.version}</span>}
      {manifest.authors?.map((author) => (
        <span
          key={author.discordId ?? author.github ?? author.displayName}
          data-tooltip={
            author.discordId
              ? `discord: ${author.discordId}`
              : author.github
                ? `github: ${author.github}`
                : undefined
          }
          data-discord-id={author.discordId}
        >
          {author.displayName}
          {author.role ? ` · ${author.role}` : ''}
        </span>
      ))}
    </span>
  )
}

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
      <p role="alert">
        these plugin settings could not load.{' '}
        <button type="button" onClick={() => this.setState({ failed: false })}>
          retry
        </button>
      </p>
    ) : (
      this.props.children
    )
  }
}

export function SettingsScreen({
  selected,
  onCategory,
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
}: {
  selected: string
  onCategory: (category: string) => void
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
  onInstallAddon: () => Promise<void>
  onRemoveAddon: (id: string) => Promise<void>
  resize: NonNullable<SidebarProps['resize']>
  cursorSettings: CursorSettings
  onCursorSettings: (settings: CursorSettings) => void
  showLineNumbers: boolean
  onShowLineNumbers: (show: boolean) => void
}) {
  const pluginPages = addons.filter(
    (addon) =>
      addon.Settings &&
      addonStates.some(
        (state) => state.id === addon.manifest.id && state.enabled,
      ),
  )
  const items = [
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
    : 'hibi'

  return (
    <SettingsDiscovery value={true}>
      <main
        className="settings-screen"
        aria-label="settings"
        hidden={!open}
        inert={!open}
      >
        <Sidebar
          resize={resize}
          className="settings-sidebar"
          items={items}
          selected={category}
          onSelect={onCategory}
          label="settings categories"
          mode="tabs"
          idPrefix="category"
          panelPrefix="settings-"
          header={
            <div className="sidebar-items">
              <button type="button" onClick={onBack}>
                <ArrowLeft size={16} aria-hidden />
                <span className="sidebar-label">back to app</span>
              </button>
            </div>
          }
          footer={
            info && (
              <div className="settings-versions">
                <span>hibi {info.version}</span>
                <span>electron {info.electron}</span>
              </div>
            )
          }
        />
        <div className="settings-content">
          <section
            id="settings-hibi"
            role="tabpanel"
            aria-labelledby="category-hibi"
            hidden={category !== 'hibi'}
          >
            {open && category === 'hibi' && <HibiSettings info={info} />}
          </section>
          <section
            id="settings-editor"
            role="tabpanel"
            aria-labelledby="category-editor"
            hidden={category !== 'editor'}
          >
            <h1>editor</h1>
            <div className="settings-group">
              <SettingRow
                id="editor-padding"
                label="content padding"
                description="space around your document in every view."
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
                    reset to 48 px
                  </Button>
                </div>
              </SettingRow>
              <SettingRow
                id="line-numbers"
                label="show line numbers"
                description="number each line in markdown and side-by-side views."
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
            id="settings-appearance"
            role="tabpanel"
            aria-labelledby="category-appearance"
            hidden={category !== 'appearance'}
          >
            <h1>appearance</h1>
            <ColorschemeSettings store={colorschemes} showLicense={false} />
            <h2>cursor</h2>
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
            <h2>window</h2>
            <div className="settings-group">
              <SettingRow
                id="hide-titlebar"
                label="hide top bar while typing"
                description="show it after a pause, or move your pointer to the top."
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
            hidden={category !== 'addons'}
          >
            <h1>addons</h1>
            <p>
              <Button onClick={() => void onInstallAddon()}>
                install addon…
              </Button>
            </p>
            <div className="settings-group">
              {addons.map(({ manifest }) => (
                <SettingRow
                  key={manifest.id}
                  id={`addon-${manifest.id}`}
                  label={manifest.name}
                  description={
                    <>
                      {manifest.description}
                      <AddonMetadata manifest={manifest} />
                    </>
                  }
                >
                  <div className="addon-actions">
                    {addonRegistry.isInstalled(manifest.id) && (
                      <Button onClick={() => void onRemoveAddon(manifest.id)}>
                        remove
                      </Button>
                    )}
                    <Toggle
                      id={`addon-${manifest.id}`}
                      aria-describedby={`addon-${manifest.id}-description`}
                      checked={addonStates.some(
                        (state) => state.id === manifest.id && state.enabled,
                      )}
                      onChange={(event) =>
                        void onAddonEnabled(manifest.id, event.target.checked)
                      }
                    />
                  </div>
                </SettingRow>
              ))}
            </div>
          </section>
          {pluginPages.map(({ manifest, Settings }) => (
            <section
              key={manifest.id}
              id={`settings-plugin-${manifest.id}`}
              role="tabpanel"
              aria-labelledby={`category-plugin-${manifest.id}`}
              hidden={category !== `plugin-${manifest.id}`}
            >
              <h1>{manifest.name}</h1>
              <p className="plugin-description">
                {manifest.description}
                <AddonMetadata manifest={manifest} />
              </p>
              {Settings && (
                <PluginSettingsBoundary key={manifest.id}>
                  <Settings />
                </PluginSettingsBoundary>
              )}
            </section>
          ))}
        </div>
      </main>
    </SettingsDiscovery>
  )
}
