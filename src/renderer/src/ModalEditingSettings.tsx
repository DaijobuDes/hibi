import { Keyboard } from 'lucide-react'
import type { AddonManifest, AddonState } from '../../addons/api'
import { Button, PanelMessage } from '../../ui/Controls'

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

  return (
    <>
      <h2>Modal editing</h2>
      <p>Enabling another modal addon asks before disabling the current one.</p>
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
