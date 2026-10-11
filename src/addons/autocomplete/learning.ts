import type { AddonStorageHandle } from '../../shared/addon-storage.ts'
import {
  createPersonalModel,
  type PersonalObservation,
  type PersonalScope,
  type PersonalSnapshot,
} from './model.ts'

/** Idle learning and serialized atomic writes; only aggregates reach storage. */
export function createLearning(
  storage: AddonStorageHandle<PersonalSnapshot>,
  schedule = (run: () => void) => {
    const id = requestIdleCallback(run, { timeout: 1000 })
    return () => cancelIdleCallback(id)
  },
) {
  const saved = storage.snapshot()
  let model = createPersonalModel({
    snapshot: saved.status === 'ready' ? saved.value : undefined,
  })
  let pending: PersonalObservation[] = []
  let cancelIdle: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let writes = Promise.resolve()
  let ownWrite: { value: string; revision: number } | undefined
  let disposed = false
  let clearing = 0
  let generation = 0

  const discard = () => {
    pending = []
    cancelIdle?.()
    cancelIdle = undefined
    clearTimeout(timer)
    timer = undefined
    generation++
  }
  const reload = () => {
    const current = storage.snapshot()
    discard()
    model = createPersonalModel({
      snapshot: current.status === 'ready' ? current.value : undefined,
    })
  }
  const unsubscribe = storage.subscribe(() => {
    const current = storage.snapshot()
    if (
      current.status === 'ready' &&
      ownWrite?.revision === current.revision &&
      ownWrite.value === JSON.stringify(current.value)
    )
      return
    reload()
  })

  function save(clear?: { scope?: PersonalScope | undefined }) {
    const epoch = generation
    const operation = writes
      .catch(() => {})
      .then(async () => {
        if (!clear && (disposed || epoch !== generation)) return
        for (let attempt = 0; attempt < (clear ? 2 : 1); attempt++) {
          if (clear) model.clear(clear.scope)
          const value = model.snapshot()
          const current = storage.snapshot()
          ownWrite = {
            value: JSON.stringify(value),
            revision: 'revision' in current ? current.revision + 1 : -1,
          }
          let result: Awaited<ReturnType<typeof storage.set>>
          try {
            result = await storage.set(value)
          } finally {
            ownWrite = undefined
          }
          if (result.status === 'saved') return
          if (result.status === 'conflict') {
            reload()
            if (clear && attempt === 0) continue
            if (!clear) return
          }
          throw new Error('Could not save learned words. Try again.')
        }
      })
    writes = operation
    return operation
  }

  function flush() {
    cancelIdle?.()
    cancelIdle = undefined
    if (disposed || clearing) return
    const batch = pending
    pending = []
    for (const observation of batch) model.observe(observation)
    if (!batch.length) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void save().catch((error) =>
        console.error('Could not save autocomplete words:', error),
      )
    }, 1000)
  }

  return {
    suggest: (request: Parameters<typeof model.suggest>[0]) =>
      model.suggest(request),
    epoch: () => generation,
    observe(observation: PersonalObservation) {
      if (disposed || clearing || observation.enabled === false) return
      // Drop excess observations instead of retaining unbounded editing history.
      if (pending.length < 128) pending.push(observation)
      cancelIdle ??= schedule(flush)
    },
    discard,
    flush,
    async clear(scope?: PersonalScope) {
      clearing++
      discard()
      try {
        await save({ scope })
      } finally {
        clearing--
      }
    },
    async persist() {
      flush()
      clearTimeout(timer)
      timer = undefined
      await save()
    },
    dispose() {
      disposed = true
      discard()
      unsubscribe()
    },
  }
}
