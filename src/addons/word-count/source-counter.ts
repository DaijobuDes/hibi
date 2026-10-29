import type {
  PreparedSourceOperation,
  SourceStore,
} from '../../shared/source-buffer.ts'
import type { RawEdit } from '../../shared/source-operations.ts'
import { countText } from './count.ts'
import { localCount, sourceCountBoundary } from './local-count.ts'

type Count = ReturnType<typeof countText>

// Larger contexts are rebuilt by the scheduled count job.
const editContextUnits = 8192

/** worker-owned literal counts over the same streamed source as formatted counts. */
export class SourceCounter {
  #count: Count | null = null
  #countedUnits = 0
  readonly store: SourceStore
  constructor(store: SourceStore) {
    this.store = store
  }
  apply({ before, operation }: PreparedSourceOperation) {
    if (!this.#count) return
    const groups: {
      from: number
      to: number
      changes: RawEdit[]
      delta: NonNullable<ReturnType<typeof localCount>>
    }[] = []
    for (const change of operation.changes) {
      const delta = localCount(
        before,
        change.from,
        change.to,
        change.insert,
        0,
        before.utf16Length,
        true,
        editContextUnits,
      )
      if (!delta) {
        this.#count = null
        return
      }
      this.#countedUnits += delta.units
      const previous = groups.at(-1)
      if (previous && delta.from <= previous.to) {
        previous.to = Math.max(previous.to, delta.to)
        previous.changes.push(change)
      } else groups.push({ ...delta, changes: [change], delta })
    }
    for (const group of groups) {
      let delta = group.delta
      if (group.changes.length > 1) {
        const text = before.sliceRaw(group.from, group.to)
        let after = text
        for (const change of group.changes.toReversed())
          after =
            after.slice(0, change.from - group.from) +
            change.insert +
            after.slice(change.to - group.from)
        const oldCount = countText(text),
          newCount = countText(after)
        this.#countedUnits += text.length + after.length
        delta = {
          ...delta,
          words: newCount.words - oldCount.words,
          characters: newCount.characters - oldCount.characters,
        }
      }
      this.#count.words += delta.words
      this.#count.characters += delta.characters
    }
  }
  *read(): Generator<void, Count> {
    if (this.#count) return { ...this.#count }
    let pending = '',
      words = 0,
      characters = 0
    // ponytail: runs without stable spaces or line endings retain their context;
    // composable unicode summaries would bound those runs too.
    for (const chunk of this.store.snapshot().chunks()) {
      let cut = -1
      for (const match of chunk.matchAll(sourceCountBoundary))
        cut = match.index + 1
      if (
        cut < 0 &&
        ((pending.endsWith(' ') && /^[a-zA-Z0-9]/.test(chunk)) ||
          (pending.endsWith('\r') && /^[^\n]/.test(chunk)))
      )
        cut = 0
      if (cut >= 0) {
        const count = countText(pending + chunk.slice(0, cut))
        words += count.words
        characters += count.characters
        pending = chunk.slice(cut)
      } else pending += chunk
      this.#countedUnits += chunk.length
      yield
    }
    const last = countText(pending)
    this.#count = {
      words: words + last.words,
      characters: characters + last.characters,
    }
    return { ...this.#count }
  }
  counters(reset = false) {
    const countedUnits = this.#countedUnits
    if (reset) this.#countedUnits = 0
    return { countedUnits }
  }
}
