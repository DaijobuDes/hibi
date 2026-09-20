import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AddonManifest, AddonState } from '../../addons/api'
import { Button, PanelMessage, SettingRow, Toggle } from '../../ui/Controls'
import {
  automaticModalSwitching,
  onModalEditingSettings,
  setAutomaticModalSwitching,
} from './modal-editing'

export function ModalEditingSettings({
  manifests,
  states,
  openAddons,
}: {
  manifests: readonly AddonManifest[]
  states: readonly AddonState[]
  openAddons: () => void
}) {
  const [automatic, setAutomatic] = useState(automaticModalSwitching)
  useEffect(
    () => onModalEditingSettings(() => setAutomatic(automaticModalSwitching())),
    [],
  )
  const modalAddons = manifests.filter((manifest) =>
    manifest.capabilities?.includes('modalEditing'),
  )
  const active = modalAddons.find((manifest) =>
    states.some((state) => state.id === manifest.id && state.enabled),
  )

  return (
    <>
      <h1>Modal editing</h1>
      <div className="settings-group">
        <SettingRow
          id="modal-editing-auto-switch"
          label="Automatically deactivate conflicting modal addons"
          description="When enabled, enabling a modal addon disables the currently active modal addon without asking."
        >
          <Toggle
            id="modal-editing-auto-switch"
            checked={automatic}
            onChange={(event) => {
              const next = event.target.checked
              setAutomaticModalSwitching(next)
              setAutomatic(next)
            }}
          />
        </SettingRow>
      </div>
      {!modalAddons.length ? (
        <PanelMessage
          icon={<Keyboard size={28} />}
          title="No modal addon installed"
        >
          No modal addon installed. This setting might not be applied.
          <br />
          <Button onClick={openAddons}>Add a modal addon</Button>
        </PanelMessage>
      ) : !active ? (
        <PanelMessage
          icon={<Keyboard size={28} />}
          title="No modal addon is currently active"
        >
          No modal addon is currently active. This setting might not be applied.
        </PanelMessage>
      ) : (
        <p>Currently active: {active.name}.</p>
      )}
    </>
  )
}
