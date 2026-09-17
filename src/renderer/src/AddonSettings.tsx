import { useState } from 'react'
import type { Addon, AddonManifest, AddonState } from '../../addons/api'
import { addonPackageUrl } from '../../shared/addon-package'
import { Button, ControlRow, SettingRow, Toggle } from '../../ui/Controls'
import { useDialogs } from '../../ui/DialogProvider'
import { SettingsFilter } from '../../ui/SettingsFilter'
import { useToasts } from '../../ui/Sonner'
import { addonRegistry } from './addon-registry'

export function AddonMetadata({ manifest }: { manifest: AddonManifest }) {
  return (
    <span className="addon-metadata">
      <span>{addonRegistry.origin(manifest.id)}</span>
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

function matches(manifest: AddonManifest, query: string) {
  return [
    manifest.name,
    manifest.description,
    manifest.kind,
    manifest.version,
    addonRegistry.origin(manifest.id),
    ...(manifest.authors?.map((author) => author.displayName) ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.trim().toLowerCase())
}

export function AddonSettings({
  addons,
  states,
  setEnabled,
  install,
  remove,
}: {
  addons: readonly Addon[]
  states: readonly AddonState[]
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  install: (url?: string) => Promise<void>
  remove: (id: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogs = useDialogs()
  const toasts = useToasts()
  const enabled = (id: string) =>
    states.some((state) => state.id === id && state.enabled)
  const changed = addons.some(
    ({ manifest }) => enabled(manifest.id) !== !!manifest.defaultEnabled,
  )
  const matching = addons.filter(({ manifest }) => matches(manifest, query))
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toasts.show({
        message: error instanceof Error ? error.message : String(error),
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }
  async function fromUrl() {
    const value = await dialogs.prompt({
      title: 'install from url',
      label: 'addon url',
      placeholder: 'https://example.com/addon.zip',
      description:
        'use a public https git repository or addon zip link. the repository must include a ready-to-use hibi-addon.json and entry. review before installing; it starts disabled.',
      confirmLabel: 'download',
      validate: (value) => {
        try {
          addonPackageUrl(value)
          return null
        } catch (error) {
          return error instanceof Error ? error.message : 'enter an https url.'
        }
      },
    })
    if (value !== null) await run(() => install(value))
  }
  return (
    <>
      <h1>addons</h1>
      <ControlRow className="addon-catalog-actions">
        <Button
          disabled={busy}
          onClick={() => void run(() => window.hibi.openAddonGarden())}
        >
          hibi garden
        </Button>
        <Button disabled={busy} onClick={() => void fromUrl()}>
          install from url
        </Button>
        <Button
          disabled={busy}
          onClick={() => void run(() => window.hibi.openAddonsFolder())}
        >
          open plugins folder
        </Button>
      </ControlRow>
      <SettingsFilter
        id="addon-filter"
        label="filter addons"
        placeholder="filter addons…"
        value={query}
        onChange={setQuery}
        disabled={busy}
        resetDisabled={!changed}
        onReset={() =>
          void run(async () => {
            for (const { manifest } of addons)
              if (enabled(manifest.id) !== !!manifest.defaultEnabled)
                await setEnabled(manifest.id, !!manifest.defaultEnabled)
          })
        }
      />
      {[true, false].map((active) => {
        const group = addons.filter(
          ({ manifest }) => enabled(manifest.id) === active,
        )
        return (
          <div
            key={String(active)}
            className="addon-state-group"
            data-enabled={active}
            hidden={!group.some((addon) => matching.includes(addon))}
          >
            <h2>{active ? 'enabled' : 'disabled'}</h2>
            <div className="settings-group">
              {group.map(({ manifest }) => (
                <SettingRow
                  key={manifest.id}
                  id={`addon-${manifest.id}`}
                  label={manifest.name}
                  hidden={!matches(manifest, query)}
                  description={
                    <>
                      {manifest.description}
                      <AddonMetadata manifest={manifest} />
                    </>
                  }
                >
                  <div className="addon-actions">
                    {addonRegistry.isInstalled(manifest.id) && (
                      <Button
                        disabled={busy}
                        onClick={() => void run(() => remove(manifest.id))}
                      >
                        remove
                      </Button>
                    )}
                    <Toggle
                      id={`addon-${manifest.id}`}
                      aria-describedby={`addon-${manifest.id}-description`}
                      disabled={busy}
                      checked={active}
                      onChange={(event) => {
                        const next = event.target.checked
                        void run(() => setEnabled(manifest.id, next))
                      }}
                    />
                  </div>
                </SettingRow>
              ))}
            </div>
          </div>
        )
      })}
      {!matching.length && <p>no matching addons.</p>}
    </>
  )
}
