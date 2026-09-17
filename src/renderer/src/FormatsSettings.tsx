import { useEffect, useState } from 'react'
import type { Addon, AddonState } from '../../addons/api'
import { errorMessage } from '../../shared/errors'
import {
  type FileAssociationState,
  fileAssociations,
} from '../../shared/file-associations'
import { Button, SettingRow, Toggle } from '../../ui/Controls'
import { SettingsFilter } from '../../ui/SettingsFilter'
import { useToasts } from '../../ui/Sonner'

export function FormatsSettings({
  active,
  addons,
  states,
  setEnabled,
  open,
}: {
  active: boolean
  addons: readonly Addon[]
  states: readonly AddonState[]
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  open: (category: string) => void
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [associations, setAssociations] = useState<FileAssociationState | null>(
    null,
  )
  const toasts = useToasts()
  useEffect(() => {
    if (!active) return
    let mounted = true
    const refresh = () =>
      void window.hibi
        .getFileAssociations()
        .then((state) => {
          if (mounted) setAssociations(state)
        })
        .catch(() => {
          if (mounted)
            toasts.show({
              message:
                'Could not read file defaults. Check your operating system’s default app settings.',
              variant: 'error',
            })
        })
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      mounted = false
      window.removeEventListener('focus', refresh)
    }
  }, [active, toasts])

  const defaultButton = (id: string) => {
    if (!Object.hasOwn(fileAssociations, id)) return null
    const format = fileAssociations[id as keyof typeof fileAssociations]
    const isDefault = format.ext.every((ext) =>
      associations?.defaults.includes(ext),
    )
    return (
      <Button
        disabled={busy || !associations?.available || isDefault}
        aria-label={`${format.name} default application`}
        title={
          associations?.available
            ? `Open .${format.ext.join(', .')} files with Hibi`
            : 'Install Hibi to manage file defaults'
        }
        onClick={async () => {
          setBusy(true)
          try {
            await window.hibi.setFileAssociation(id)
            if (associations?.systemSettings) {
              toasts.show({
                message: `In Default apps, choose Hibi for .${format.ext.join(' and .')}.`,
              })
            }
            setAssociations(await window.hibi.getFileAssociations())
          } catch (error) {
            toasts.show({
              message: errorMessage(error),
              variant: 'error',
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        {isDefault
          ? 'Default app'
          : associations?.systemSettings
            ? 'Choose default…'
            : 'Make default'}
      </Button>
    )
  }
  const formats = addons.filter(
    ({ manifest }) =>
      manifest.fileExtensions?.length &&
      states.some((state) => state.id === manifest.id && state.enabled),
  )
  const matching = formats.filter(({ manifest }) =>
    `${manifest.name} ${manifest.fileExtensions?.map((extension) => `.${extension}`).join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const plainText = 'plain text .txt'.includes(query.trim().toLowerCase())
  return (
    <>
      <h1>Formats</h1>
      <p className="plugin-description">
        Enable more document formats in{' '}
        <Button onClick={() => open('addons')}>Addons</Button>.
      </p>
      <p className="plugin-description">
        Open files with Hibi from your file manager, or choose it as the default
        app for a format below.
        {associations &&
          !associations.available &&
          ' Install Hibi to manage file defaults; development and preview builds leave them unchanged.'}
      </p>
      <SettingsFilter
        id="formats-filter"
        label="Filter formats"
        placeholder="Filter formats…"
        value={query}
        onChange={setQuery}
      />
      <h2>Document formats</h2>
      <div className="settings-group">
        <SettingRow
          id="format-text"
          label="Plain text"
          hidden={!plainText}
          description=".txt · Built in"
        >
          {defaultButton('text')}
          <span className="setting-availability">Always available</span>
        </SettingRow>
        {formats.map(({ manifest }) => (
          <SettingRow
            key={manifest.id}
            id={`format-${manifest.id}`}
            label={manifest.name}
            hidden={
              !matching.some((addon) => addon.manifest.id === manifest.id)
            }
            description={manifest.fileExtensions
              ?.map((extension) => `.${extension}`)
              .join(' · ')}
          >
            {defaultButton(manifest.id)}
            <Button
              onClick={() => open(`plugin-${manifest.id}`)}
              aria-label={`${manifest.name} settings`}
            >
              Settings
            </Button>
            {manifest.id === 'markdown' ? (
              <span className="setting-availability">Always available</span>
            ) : (
              <Toggle
                id={`format-${manifest.id}`}
                disabled={busy}
                checked={states.some(
                  (state) => state.id === manifest.id && state.enabled,
                )}
                onChange={async (event) => {
                  setBusy(true)
                  try {
                    await setEnabled(manifest.id, event.target.checked)
                  } catch (error) {
                    toasts.show({
                      message:
                        error instanceof Error ? error.message : String(error),
                      variant: 'error',
                    })
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            )}
          </SettingRow>
        ))}
      </div>
      {!matching.length && !plainText && <p>No matching formats.</p>}
    </>
  )
}
