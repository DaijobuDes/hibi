import type { AddonManifest } from '../addons/api'

/** This first network capability reads bounded UTF-8 text over HTTPS GET. */
export const HOST_NETWORK_CHANNELS = {
  getText: 'host-network:get-text',
} as const

export interface HostTextRequest {
  readonly url: string
  /** Stored under this addon's host credentials; sent once as an HTTPS bearer token. */
  readonly credentialKey?: string
}

export interface HostTextResponse {
  readonly url: string
  readonly status: number
  readonly text: string
}

export type HostNetworkFailure =
  | 'invalid-request'
  | 'permission-denied'
  | 'limit-exceeded'
  | 'timeout'
  | 'cancelled'
  | 'stale'
  | 'busy'
  | 'unavailable'
  | 'http-status'

export type HostTextResult =
  | { readonly ok: true; readonly value: HostTextResponse }
  | {
      readonly ok: false
      readonly code: HostNetworkFailure
      readonly status?: number
    }

/** Keep package declarations canonical so request origins can match exactly. */
export function parseAddonNetwork(
  value: unknown,
): NonNullable<AddonManifest['network']> {
  const invalid = () => {
    throw new Error('The addon must declare exact public HTTPS origins.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  const { origins } = value as Record<string, unknown>
  if (
    Object.keys(value).some((key) => key !== 'origins') ||
    !Array.isArray(origins) ||
    origins.length < 1 ||
    origins.length > 16 ||
    new Set(origins).size !== origins.length
  )
    return invalid()
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.length > 2048) return invalid()
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      return invalid()
    }
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.port === '0' ||
      /^[\d.]+$/.test(url.hostname) ||
      !url.hostname.includes('.') ||
      /\.(?:localhost|local|lan|internal|home\.arpa)$/.test(url.hostname) ||
      url.hostname === 'home.arpa' ||
      url.hostname.length > 253 ||
      !url.hostname
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      return invalid()
  }
  return { origins: [...origins] }
}
