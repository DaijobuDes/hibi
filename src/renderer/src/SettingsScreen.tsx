import { FileText, Info, Keyboard, PanelTop } from 'lucide-react'
import { useState } from 'react'
import type { AppInfo } from '../../shared/desktop'
import type { Hotkeys } from '../../shared/hotkeys'
import { HotkeySettings } from './HotkeySettings'

const categories = [
  { id: 'editor', label: 'editor', icon: FileText },
  { id: 'appearance', label: 'appearance', icon: PanelTop },
  { id: 'hotkeys', label: 'hotkeys', icon: Keyboard },
  { id: 'about', label: 'about hibi', icon: Info },
] as const

export function SettingsScreen({
  open,
  padding,
  onPadding,
  hideTitlebar,
  onHideTitlebar,
  info,
  hotkeys,
  onHotkeys,
}: {
  open: boolean
  padding: number
  onPadding: (padding: number) => void
  hideTitlebar: boolean
  onHideTitlebar: (hide: boolean) => void
  info: AppInfo | null
  hotkeys: Hotkeys
  onHotkeys: (hotkeys: Hotkeys) => void
}) {
  const [category, setCategory] =
    useState<(typeof categories)[number]['id']>('editor')

  return (
    <main
      className="settings-screen"
      aria-label="settings"
      hidden={!open}
      inert={!open}
    >
      <aside className="settings-sidebar">
        <div
          className="settings-categories"
          role="tablist"
          aria-label="settings categories"
          aria-orientation="vertical"
        >
          <span
            className="category-selection"
            aria-hidden="true"
            style={{
              transform: `translateY(${categories.findIndex(({ id }) => id === category) * 28}px)`,
            }}
          />
          {categories.map(({ id, label, icon: Icon }, index) => (
            <button
              type="button"
              key={id}
              id={`category-${id}`}
              role="tab"
              aria-selected={category === id}
              aria-controls={`settings-${id}`}
              tabIndex={category === id ? 0 : -1}
              onClick={() => {
                setCategory(id)
              }}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowDown'
                    ? (index + 1) % categories.length
                    : event.key === 'ArrowUp'
                      ? (index + categories.length - 1) % categories.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? categories.length - 1
                          : null
                if (next === null) return
                event.preventDefault()
                const item = categories[next]
                if (item) {
                  setCategory(item.id)
                  window.document.getElementById(`category-${item.id}`)?.focus()
                }
              }}
            >
              <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="settings-content">
        <section
          id="settings-editor"
          role="tabpanel"
          aria-labelledby="category-editor"
          hidden={category !== 'editor'}
        >
          <h1>editor</h1>
          <div className="setting-row">
            <label htmlFor="editor-padding">content padding</label>
            <p>space around your document in every view.</p>
            <div className="padding-control">
              <input
                id="editor-padding"
                type="range"
                min="0"
                max="96"
                step="4"
                value={padding}
                onChange={(event) => onPadding(Number(event.target.value))}
              />
              <output htmlFor="editor-padding">{padding} px</output>
            </div>
            <button
              type="button"
              className="setting-reset"
              onClick={() => onPadding(48)}
            >
              reset to 48 px
            </button>
          </div>
        </section>
        <section
          id="settings-appearance"
          role="tabpanel"
          aria-labelledby="category-appearance"
          hidden={category !== 'appearance'}
        >
          <h1>appearance</h1>
          <div className="setting-row">
            <label className="setting-checkbox">
              <input
                type="checkbox"
                checked={hideTitlebar}
                onChange={(event) => onHideTitlebar(event.target.checked)}
              />
              <span>hide top bar while typing</span>
            </label>
            <p>
              show it again after a short pause, or move your pointer to the
              top.
            </p>
          </div>
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
          id="settings-about"
          role="tabpanel"
          aria-labelledby="category-about"
          hidden={category !== 'about'}
        >
          <h1>hibi</h1>
          <p className="about-description">a quiet place to write markdown.</p>
          {info && (
            <dl className="app-details">
              <div>
                <dt>version</dt>
                <dd>{info.version}</dd>
              </div>
              <div>
                <dt>electron</dt>
                <dd>{info.electron}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </main>
  )
}
