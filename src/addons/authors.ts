import type { AddonAuthor } from './api'

export const authors = {
  may: { discordId: '1262793452236570667', displayName: 'may' },
} as const satisfies Record<string, AddonAuthor>
