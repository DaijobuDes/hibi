# plugin authors

generated from `src/addons/authors.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
import type { AddonAuthor } from './api'

export const authors = {
  may: { discordId: '1262793452236570667', displayName: 'may' },
} as const satisfies Record<string, AddonAuthor>
```
