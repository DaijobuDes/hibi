import { CircleHelp } from 'lucide-react'
import type { AddonManifest, AddonState } from '../../addons/api'
import { Button, SettingRow } from '../../ui/Controls'

export function ModalEditingSettings({
  manifests,
  states,
  openAddons,
}: {
  manifests: readonly AddonManifest[]
  states: readonly AddonState[]
  openAddons: () => void
}) {
  const modalAddons = manifests.filter((manifest) =>
    manifest.capabilities?.includes('modalEditing'),
  )
  const active = modalAddons.find((manifest) =>
    states.some((state) => state.id === manifest.id && state.enabled),
  )
  const warning = 'This setting might not be applied.'
  const help = (
    <CircleHelp size={16} aria-label={warning} data-tooltip={warning} />
  )

  return (
    <>
      <h2>Modal editing</h2>
      <div className="settings-group">
        <SettingRow
          id="modal-editing-status"
          label={
            active ? 'Active modal addon' : 'No modal addon is currently active'
          }
          description={
            active
              ? 'Enabling another modal addon asks before disabling this one.'
              : undefined
          }
        >
          {active ? active.name : help}
        </SettingRow>
        {!modalAddons.length && (
          <SettingRow
            id="modal-editing-add"
            label="Modal addon"
            description="Install a modal addon to use modal editing."
          >
            <Button onClick={openAddons}>Add a modal addon</Button>
          </SettingRow>
        )}
      </div>
    </>
  )
}
