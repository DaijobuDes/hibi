import type { AddonStorageHandle } from '../../shared/addon-storage.ts'
import {
  createPersonalModel,
  type PersonalObservation,
  type PersonalRequest,
  type PersonalScope,
  type PersonalSnapshot,
} from './model.ts'
import type { AutocompletePreferences } from './settings.ts'

export type LearningObservation = PersonalObservation & { documentId: string }

/** Idle learning and serialized atomic writes; only aggregates reach storage. */
export function createLearning(
  storage: AddonStorageHandle<PersonalSnapshot>,
  schedule = (run: (deadline?: IdleDeadline) => void) => {
    const id = requestIdleCallback(run, { timeout: 1000 })
    return () => cancelIdleCallback(id)
  },
) {
  let model: ReturnType<typeof createPersonalModel> | undefined
  const getModel = () => {
    if (!model) {
      const saved = storage.snapshot()
      model = createPersonalModel({
        snapshot: saved.status === 'ready' ? saved.value : undefined,
      })
    }
    return model
  }
  let pending: LearningObservation[] = []
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
    discard()
    model = undefined
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
    if (!clear && !model) return writes
    const epoch = generation
    const operation = writes
      .catch(() => {})
      .then(async () => {
        if (!clear && (disposed || epoch !== generation)) return
        for (let attempt = 0; attempt < (clear ? 2 : 1); attempt++) {
          if (clear) getModel().clear(clear.scope)
          const value = getModel().snapshot()
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

  function flush(deadline?: IdleDeadline) {
    cancelIdle?.()
    cancelIdle = undefined
    if (disposed || clearing) return
    let consumed = 0
    while (consumed < pending.length) {
      if (
        deadline &&
        deadline.timeRemaining() <= 1 &&
        !(deadline.didTimeout && !consumed)
      )
        break
      getModel().observe(pending[consumed] as PersonalObservation)
      consumed++
    }
    pending = pending.slice(consumed)
    if (pending.length) cancelIdle = schedule(flush)
    if (!consumed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void save().catch((error) =>
        console.error('Could not save autocomplete words:', error),
      )
    }, 1000)
  }

  cancelIdle = schedule((deadline) => {
    getModel()
    flush(deadline)
  })

  return {
    suggest: (request: PersonalRequest) => getModel().suggest(request),
    epoch: () => generation,
    observe(observation: LearningObservation) {
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
    async persist(
      preferences?: Pick<
        AutocompletePreferences,
        'learning' | 'excludedDocuments' | 'excludedWorkspaces'
      >,
    ) {
      if (preferences)
        pending = pending.filter(
          (observation) =>
            preferences.learning &&
            !preferences.excludedDocuments.includes(observation.documentId) &&
            !preferences.excludedWorkspaces.includes(observation.scope ?? ''),
        )
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
