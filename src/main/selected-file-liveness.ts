import type { BrowserWindow, WebContents } from 'electron'
import type { AddonOwner } from '../shared/foundation-contracts'

export type SelectedFileActivation = {
  owner: AddonOwner
  session: WebContents
  serviceEpoch: number
  ownerEpoch: number
}

export class SelectedFileLiveness {
  private serviceEpoch = 0
  private readonly ownerEpochs = new Map<string, number>()
  private readonly currentOwner: (addonId: string) => AddonOwner | null

  constructor(currentOwner: (addonId: string) => AddonOwner | null) {
    this.currentOwner = currentOwner
  }

  capture(
    window: BrowserWindow,
    addonId: unknown,
  ): SelectedFileActivation | null {
    const owner = this.owner(addonId)
    const session = this.session(window)
    if (!owner || !session) return null
    return {
      owner,
      session,
      serviceEpoch: this.serviceEpoch,
      ownerEpoch: this.ownerEpochs.get(owner.addonId) ?? 0,
    }
  }

  live(window: BrowserWindow, activation: SelectedFileActivation): boolean {
    return (
      this.serviceEpoch === activation.serviceEpoch &&
      (this.ownerEpochs.get(activation.owner.addonId) ?? 0) ===
        activation.ownerEpoch &&
      this.session(window) === activation.session &&
      this.owner(activation.owner.addonId)?.activationGeneration ===
        activation.owner.activationGeneration
    )
  }

  revokeAddon(addonId: string): void {
    this.ownerEpochs.set(addonId, (this.ownerEpochs.get(addonId) ?? 0) + 1)
  }

  clear(): void {
    this.serviceEpoch += 1
    this.ownerEpochs.clear()
  }

  session(window: BrowserWindow): WebContents | null {
    try {
      if (window.isDestroyed()) return null
      const session = window.webContents
      return session.isDestroyed() ? null : session
    } catch {
      return null
    }
  }

  private owner(addonId: unknown): AddonOwner | null {
    if (typeof addonId !== 'string') return null
    try {
      const owner = this.currentOwner(addonId)
      return owner?.addonId === addonId &&
        Number.isSafeInteger(owner.activationGeneration) &&
        owner.activationGeneration >= 0
        ? { ...owner }
        : null
    } catch {
      return null
    }
  }
}
