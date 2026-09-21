import { useEffect, useState } from 'react'
import { errorMessage } from '../../shared/errors'
import type { UpdateChannel, UpdateState } from '../../shared/updates'
import { Button, Select, SettingRow } from '../../ui/Controls'

export function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const receive = (next: UpdateState) => {
      if (active) setState(next)
    }
    const unsubscribe = window.hibi.onUpdateChanged(receive)
    void window.hibi
      .getUpdateState()
      .then(receive)
      .catch((error) => {
        if (active) setError(errorMessage(error))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const waiting =
    busy ||
    !state ||
    state.status === 'checking' ||
    state.status === 'downloading'
  return (
    <>
      <h2>Updates</h2>
      <div className="settings-group">
        <SettingRow
          id="update-channel"
          label="Update channel"
          description="Recommended nightly includes builds that passed every required check. Nightly also includes builds with failed checks."
        >
          <Select
            id="update-channel"
            aria-describedby="update-channel-description"
            disabled={waiting}
            value={state?.channel ?? 'nightly-green'}
            onChange={(event) =>
              void run(() =>
                window.hibi.setUpdateChannel(
                  event.target.value as UpdateChannel,
                ),
              )
            }
          >
            <option value="nightly-green">Recommended nightly</option>
            <option value="nightly">Nightly</option>
          </Select>
        </SettingRow>
        <SettingRow
          id="check-updates"
          label="Check for updates"
          description="Hibi checks at startup and every six hours. Downloads start when you choose."
        >
          <Button
            id="check-updates"
            aria-label="Check for updates"
            disabled={waiting || !state?.supported}
            onClick={() => void run(() => window.hibi.checkForUpdates())}
          >
            {state?.status === 'checking' ? 'Checking…' : 'Check now'}
          </Button>
        </SettingRow>
        <SettingRow
          id="install-update"
          label={state?.version ? `Version ${state.version}` : 'Update status'}
          description={
            <span
              role={error || state?.status === 'error' ? 'alert' : 'status'}
            >
              {error || state?.message || 'Loading update settings…'}
              {state?.broken &&
                ' This nightly failed required checks and may be broken.'}
              {state?.status === 'downloading' && ` ${state.progress ?? 0}%`}
            </span>
          }
        >
          {state?.version &&
            (state.status === 'available' || state.status === 'error') && (
              <Button
                id="install-update"
                aria-label="Download update"
                disabled={waiting}
                onClick={() => void run(() => window.hibi.downloadUpdate())}
              >
                Download update
              </Button>
            )}
          {state?.status === 'downloaded' && (
            <Button
              id="install-update"
              aria-label={
                state.manualInstall ? 'Open installer' : 'Restart and install'
              }
              disabled={waiting}
              onClick={() => void run(() => window.hibi.installUpdate())}
            >
              {state.manualInstall ? 'Open installer' : 'Restart and install'}
            </Button>
          )}
        </SettingRow>
      </div>
    </>
  )
}
