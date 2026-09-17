# code language api

generated from `src/shared/syntax.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
import type { Language } from '@codemirror/language'

/** One parser serves source fences, rich code blocks, and static exports. */
export type CodeLanguage = {
  id: string
  aliases?: readonly string[]
  language: Language
}
```
