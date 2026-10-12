import { LANGS, type Lang } from '../dictionary/providers.ts'

export type PersonalScope = string | null
type Session = {
  /** Stable workspace identity; null is reserved for documents outside a workspace. */
  scope: PersonalScope
  /** Session membership, not inferred language identification. */
  languages: readonly Lang[]
  context?: readonly string[]
  enabled?: boolean
  sensitive?: boolean
}
export type PersonalObservation = Session & {
  word: string
  kind: 'typed' | 'accepted' | 'undo' | 'overwrite' | 'ignored'
}
export type BaseCandidate = { word: string; lang: Lang; custom?: boolean }
export type PersonalRequest = Session & {
  /** Empty after a space to ask for the next word. */
  prefix: string
  /** Already ranked by the dictionary; order calibrates the baseline score. */
  baseline?: readonly BaseCandidate[]
  limit?: number
}
export type PersonalSuggestion = {
  word: string
  lang: Lang
  score: number
  source: 'baseline' | 'personal'
}
type Row = {
  scope: PersonalScope
  languages: Lang[]
  context: string[]
  word: string
  count: number
  corrections: number
  updatedAt: number
  lastUsed: number
}
export type PersonalSnapshot = { version: 1; entries: Row[] }
export type PersonalModelOptions = {
  snapshot?: unknown
  now?: () => number
  maxEntries?: number
  halfLifeMs?: number
}

const DAY = 86_400_000
const MAX_ENTRIES = 8192
const MAX_SCOPES = 16
const CANDIDATES = 32
const MAX_COUNT = 1_000_000
const CORRECTION_WINDOW = 10_000
const token = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u

/** Defense in depth; callers must still exclude sensitive fields and document regions. */
function safeWord(word: unknown): word is string {
  return (
    typeof word === 'string' &&
    word.length > 0 &&
    word.length <= 64 &&
    token.test(word) &&
    !/^(?:sk|pk|ghp|github|token|secret|password|bearer|api-key)-/i.test(
      word,
    ) &&
    !/^[a-f]{16,}$/i.test(word) &&
    !/^eyJ[A-Za-z]/.test(word) &&
    !(
      word.length >= 24 &&
      (word.match(/[a-z][A-Z]|[A-Z][a-z]/g)?.length ?? 0) >= 6
    ) &&
    !(word.length >= 32 && new Set(word.toLowerCase()).size >= 16)
  )
}
function safeScope(scope: unknown): scope is PersonalScope {
  return (
    scope === null ||
    (typeof scope === 'string' && scope.length > 0 && scope.length <= 1024)
  )
}
function languages(input: readonly Lang[]): Lang[] {
  return LANGS.filter((lang) => input.includes(lang))
}
function contextWords(input: readonly string[] = []): string[] {
  const tail = input.slice(-2)
  // Never connect words across an excluded token.
  const invalid = tail.findLastIndex((word) => !safeWord(word))
  return tail.slice(invalid + 1)
}
function rowKey(row: Pick<Row, 'scope' | 'languages' | 'context' | 'word'>) {
  return JSON.stringify([row.scope, row.languages, row.context, row.word])
}
function bucketKey(
  scope: PersonalScope,
  lang: Lang,
  context: readonly string[],
  prefix: string,
) {
  return JSON.stringify([scope, lang, context, prefix])
}

/** One synchronous, local model per user profile. No IO or document text retention. */
export function createPersonalModel(options: PersonalModelOptions = {}) {
  const now = options.now ?? Date.now
  const maxEntries = Number.isFinite(options.maxEntries)
    ? Math.max(1, Math.min(MAX_ENTRIES, Math.floor(options.maxEntries ?? 4096)))
    : 4096
  const halfLife =
    Number.isFinite(options.halfLifeMs) && (options.halfLifeMs ?? 0) > 0
      ? (options.halfLifeMs ?? 30 * DAY)
      : 30 * DAY
  const rows = new Map<string, Row>()
  const buckets = new Map<string, Row[]>()
  // Recent accepts are transient, bounded, and never serialized.
  const accepted = new Map<string, number>()
  const decay = (row: Row, time: number) =>
    2 ** (-Math.max(0, time - row.updatedAt) / halfLife)
  const strength = (row: Row, time: number) =>
    (row.count + row.corrections) * decay(row, time)

  function index(row: Row, time: number) {
    const lower = row.word.normalize('NFC').toLowerCase()
    for (const lang of row.languages)
      for (let length = 0; length <= lower.length; length++) {
        const key = bucketKey(
          row.scope,
          lang,
          row.context,
          lower.slice(0, length),
        )
        const list = buckets.get(key) ?? []
        if (!list.includes(row)) list.push(row)
        list.sort(
          (a, b) =>
            strength(b, time) - strength(a, time) || b.lastUsed - a.lastUsed,
        )
        list.length = Math.min(list.length, CANDIDATES)
        buckets.set(key, list)
      }
  }
  function rebuild(time: number) {
    buckets.clear()
    for (const row of rows.values()) index(row, time)
  }
  function prune(time: number) {
    let changed = false
    for (const [key, row] of rows)
      if (strength(row, time) < 0.02) {
        rows.delete(key)
        accepted.delete(key)
        changed = true
      }
    const scopes = new Map<PersonalScope, number>()
    for (const row of rows.values())
      scopes.set(row.scope, Math.max(scopes.get(row.scope) ?? 0, row.lastUsed))
    const keepScopes = new Set(
      [...scopes]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SCOPES)
        .map(([scope]) => scope),
    )
    for (const [key, row] of rows)
      if (!keepScopes.has(row.scope)) {
        rows.delete(key)
        accepted.delete(key)
        changed = true
      }
    if (rows.size > maxEntries) {
      const keep = new Set(
        [...rows]
          .sort(
            (a, b) =>
              strength(b[1], time) - strength(a[1], time) ||
              b[1].lastUsed - a[1].lastUsed,
          )
          .slice(0, Math.max(1, Math.floor(maxEntries * 0.9)))
          .map(([key]) => key),
      )
      for (const key of rows.keys())
        if (!keep.has(key)) {
          rows.delete(key)
          accepted.delete(key)
        }
      changed = true
    }
    if (changed) rebuild(time)
  }

  function load(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== 'object') return
    const saved = snapshot as Partial<PersonalSnapshot>
    if (
      saved.version !== 1 ||
      !Array.isArray(saved.entries) ||
      saved.entries.length > MAX_ENTRIES
    )
      return
    const time = now()
    for (const entry of saved.entries) {
      if (!entry || typeof entry !== 'object') continue
      if (
        !safeScope(entry.scope) ||
        !safeWord(entry.word) ||
        !Array.isArray(entry.languages) ||
        !entry.languages.length ||
        entry.languages.length > LANGS.length ||
        !entry.languages.every((lang) => LANGS.includes(lang)) ||
        new Set(entry.languages).size !== entry.languages.length ||
        !Array.isArray(entry.context) ||
        entry.context.length > 2 ||
        !entry.context.every(safeWord) ||
        ![entry.count, entry.corrections].every(
          (value) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= MAX_COUNT,
        ) ||
        ![entry.updatedAt, entry.lastUsed].every(
          (value) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= time,
        ) ||
        entry.lastUsed > entry.updatedAt
      )
        continue
      const row: Row = {
        scope: entry.scope,
        languages: languages(entry.languages),
        context: [...entry.context],
        word: entry.word,
        count: entry.count,
        corrections: entry.corrections,
        updatedAt: entry.updatedAt,
        lastUsed: entry.lastUsed,
      }
      // Duplicate rows cannot amplify supplied evidence.
      const key = rowKey(row)
      if (!rows.has(key)) rows.set(key, row)
    }
    prune(time)
    rebuild(time)
  }
  load(options.snapshot)

  function observe(event: PersonalObservation): void {
    if (
      event.enabled === false ||
      event.sensitive ||
      event.kind === 'ignored' ||
      !safeScope(event.scope) ||
      !safeWord(event.word)
    )
      return
    const langs = languages(event.languages)
    if (!langs.length) return
    const context = contextWords(event.context)
    const time = now()
    const contexts = [
      [],
      ...context.map((_, i) => context.slice(context.length - i - 1)),
    ]
    const exactKey = rowKey({
      scope: event.scope,
      languages: langs,
      context,
      word: event.word,
    })
    const correction = event.kind === 'undo' || event.kind === 'overwrite'
    const acceptedAt = accepted.get(exactKey)
    if (correction) {
      const at = acceptedAt
      if (at === undefined || time < at || time - at > CORRECTION_WINDOW) return
      accepted.delete(exactKey)
    }
    for (const words of contexts) {
      const key = rowKey({
        scope: event.scope,
        languages: langs,
        context: words,
        word: event.word,
      })
      let row = rows.get(key)
      if (!row && correction) continue
      if (!row) {
        row = {
          scope: event.scope,
          languages: langs,
          context: words,
          word: event.word,
          count: 0,
          corrections: 0,
          updatedAt: time,
          lastUsed: time,
        }
        rows.set(key, row)
      }
      const factor = decay(row, time)
      row.count = row.count * factor
      row.corrections *= factor
      row.updatedAt = time
      if (correction) {
        row.count = Math.max(
          0,
          row.count - 2 * 2 ** (-(time - (acceptedAt ?? time)) / halfLife),
        )
        if (key === exactKey)
          row.corrections = Math.min(MAX_COUNT, row.corrections + 1)
      } else {
        row.count = Math.min(
          MAX_COUNT,
          row.count + (event.kind === 'accepted' ? 2 : 1),
        )
        row.lastUsed = time
      }
      index(row, time)
    }
    if (event.kind === 'accepted') {
      accepted.delete(exactKey)
      accepted.set(exactKey, time)
      while (accepted.size > maxEntries) {
        const key = accepted.keys().next().value
        if (key !== undefined) accepted.delete(key)
      }
    }
    // Maintenance happens at commit time, never on the ranking path.
    prune(time)
  }

  function suggest(request: PersonalRequest): PersonalSuggestion[] {
    if (!safeScope(request.scope) || request.sensitive) return []
    const langs = languages(request.languages)
    if (
      !langs.length ||
      request.prefix.length > 64 ||
      (request.prefix && !safeWord(request.prefix))
    )
      return []
    const prefix = request.prefix.normalize('NFC').toLowerCase()
    const limit = Number.isFinite(request.limit)
      ? Math.max(0, Math.min(32, Math.floor(request.limit ?? 8)))
      : 8
    if (!prefix) {
      if (request.enabled === false || !limit) return []
      const context = contextWords(request.context)
      const time = now()
      for (let length = context.length; length > 0; length--) {
        const candidates = new Map<string, PersonalSuggestion>()
        for (const lang of langs)
          for (const row of buckets.get(
            bucketKey(request.scope, lang, context.slice(-length), ''),
          ) ?? []) {
            const score = (row.count - 2 * row.corrections) * decay(row, time)
            if (score <= 0) continue
            if (score > (candidates.get(row.word)?.score ?? 0))
              candidates.set(row.word, {
                word: row.word,
                lang,
                score,
                source: 'personal',
              })
          }
        const ranked = [...candidates.values()].sort(
          (a, b) => b.score - a.score,
        )
        const first = ranked[0]
        if (!first) continue
        // An ambiguous longer context must not fall back to a broader habit.
        return first.score >= 2.5 &&
          first.score >= 1.5 * (ranked[1]?.score ?? 0)
          ? [first]
          : []
      }
      return []
    }
    const candidates = new Map<string, PersonalSuggestion>()
    const baseline = (request.baseline ?? [])
      .slice(0, 128)
      .filter(
        (item) =>
          langs.includes(item.lang) &&
          typeof item.word === 'string' &&
          item.word.length <= 64 &&
          !/[\r\n]/.test(item.word) &&
          item.word
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .startsWith(prefix.normalize('NFD').replace(/\p{M}/gu, '')) &&
          item.word.normalize('NFC').toLowerCase() !== prefix,
      )
    for (const [i, item] of baseline.entries()) {
      const score = item.custom
        ? 1.05 + 0.1 * (1 - i / Math.max(1, baseline.length))
        : 1 - i / Math.max(1, baseline.length)
      if (score > (candidates.get(item.word)?.score ?? -Infinity))
        candidates.set(item.word, {
          word: item.word,
          lang: item.lang,
          score,
          source: 'baseline',
        })
    }
    if (request.enabled === false)
      return [...candidates.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    const context = contextWords(request.context)
    const contexts = [
      [],
      ...context.map((_, i) => context.slice(context.length - i - 1)),
    ]
    const evidence = new Map<
      string,
      {
        count: number
        context: number
        penalty: number
        lastUsed: number
        lang: Lang
      }
    >()
    const time = now()
    const visited = new Set<Row>()
    for (const words of contexts)
      for (const lang of langs)
        for (const row of buckets.get(
          bucketKey(request.scope, lang, words, prefix),
        ) ?? []) {
          if (
            visited.has(row) ||
            row.word.normalize('NFC').toLowerCase() === prefix
          )
            continue
          visited.add(row)
          const factor = decay(row, time)
          if ((row.count + row.corrections) * factor < 0.02) continue
          const signals = evidence.get(row.word) ?? {
            count: 0,
            context: 0,
            penalty: 0,
            lastUsed: 0,
            lang,
          }
          // Language-set variants overlap; take strongest evidence rather than counting twice.
          if (!words.length)
            signals.count = Math.max(signals.count, row.count * factor)
          else
            signals.context = Math.max(
              signals.context,
              row.count * factor * (words.length === 2 ? 1 : 0.7),
            )
          signals.penalty = Math.max(signals.penalty, row.corrections * factor)
          signals.lastUsed = Math.max(signals.lastUsed, row.lastUsed)
          evidence.set(row.word, signals)
        }
    for (const [word, signals] of evidence) {
      const candidate = candidates.get(word) ?? {
        word,
        lang: signals.lang,
        score: 0,
        source: 'personal' as const,
      }
      const confidence = signals.count / (signals.count + 12)
      const observations = Math.max(signals.count, signals.context)
      const reliability = observations / (observations + 8)
      candidate.score +=
        reliability *
          (1.5 * confidence +
            (1.3 * signals.context) / (signals.context + 8) +
            0.1 *
              confidence *
              2 ** (-Math.max(0, time - signals.lastUsed) / (7 * DAY))) -
        (0.8 * signals.penalty) / (signals.penalty + 2)
      if (
        candidate.source === 'baseline' ||
        signals.count > 0 ||
        signals.context > 0
      )
        candidates.set(word, candidate)
    }
    return [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  function snapshot(): PersonalSnapshot {
    const time = now()
    prune(time)
    return {
      version: 1,
      entries: [...rows.values()].map((row) => ({
        ...row,
        languages: [...row.languages],
        context: [...row.context],
        count: row.count * decay(row, time),
        corrections: row.corrections * decay(row, time),
        updatedAt: time,
      })),
    }
  }

  function clear(scope?: PersonalScope): void {
    for (const [key, row] of rows)
      if (scope === undefined || row.scope === scope) {
        rows.delete(key)
        accepted.delete(key)
      }
    rebuild(now())
  }

  return { observe, suggest, snapshot, clear }
}
