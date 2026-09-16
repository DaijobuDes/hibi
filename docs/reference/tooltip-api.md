# tooltip api

generated from `src/ui/tooltips.ts`. update the source, then run `npm run docs`. `npm run docs:check` rejects stale references.

```typescript
export type TooltipOptions = {
  anchor: HTMLElement
  text: string
  placement?: 'top' | 'bottom'
}
export type TooltipApi = {
  /** Show plain text next to an element; the returned function hides only this tooltip. */
  show: (options: TooltipOptions) => () => void
  hide: () => void
}
```
