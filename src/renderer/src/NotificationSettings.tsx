import { useSyncExternalStore } from 'react'
import { Button, Select, SettingRow } from '../../ui/Controls'
import { useToastService } from '../../ui/Sonner'
import { type ToastPosition, toastPositions } from '../../ui/toasts'

export function NotificationSettings() {
  const service = useToastService()
  const { preferences } = useSyncExternalStore(
    service.subscribe,
    service.snapshot,
  )
  return (
    <>
      <h2>notifications</h2>
      <div className="settings-group">
        <SettingRow
          id="notification-position"
          label="position"
          description="where notifications appear in the window."
        >
          <Select
            id="notification-position"
            value={preferences.position}
            onChange={(event) =>
              service.api.setPreferences({
                position: event.target.value as ToastPosition,
              })
            }
          >
            {toastPositions.map((position) => (
              <option key={position} value={position}>
                {position.replace('center', 'middle').replace('-', ' ')}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          id="notification-duration"
          label="dismiss after"
          description="hover or focus a notification to pause its countdown."
        >
          <Select
            id="notification-duration"
            value={preferences.duration}
            onChange={(event) =>
              service.api.setPreferences({
                duration: Number(event.target.value),
              })
            }
          >
            {[
              ...new Set([3000, 5000, 8000, 10000, 0, preferences.duration]),
            ].map((duration) => (
              <option key={duration} value={duration}>
                {duration ? `${duration / 1000} seconds` : 'never'}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          id="notification-preview"
          label="preview"
          description="try the current position and countdown."
        >
          <Button
            id="notification-preview"
            aria-label="show preview"
            onClick={() =>
              service.api.show({
                message: 'notification preview',
                description: preferences.duration
                  ? 'hover to pause the countdown.'
                  : 'stays until you dismiss it.',
                variant: 'success',
              })
            }
          >
            show preview
          </Button>
        </SettingRow>
      </div>
    </>
  )
}
