import type { ViewTarget } from './foundation-contracts'

/** Positions are editor-local: CodeMirror and ProseMirror offsets are distinct. */
export interface CompletionRequest {
  readonly view: ViewTarget
  readonly contentVersion: number
  readonly editor: 'source' | 'rich'
  readonly documentLength: number
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly before: string
  readonly after: string
  /** Safe prose around the caret; null when syntax or sensitive text prevents capture. */
  readonly prose?: { readonly before: string; readonly after: string } | null
  readonly trigger:
    | { readonly kind: 'explicit' }
    | { readonly kind: 'input'; readonly character: string }
}

/** Data only; the host validates and applies an accepted edit in one undo step. */
export interface CompletionItem {
  readonly label: string
  readonly detail?: string
  readonly insertText: string
  readonly from: number
  readonly to: number
  readonly rank?: number
  /** False leaves Tab to the editor; Enter still accepts. Defaults to true. */
  readonly acceptOnTab?: boolean
}

export type CompletionProvider = (
  request: CompletionRequest,
  signal: AbortSignal,
) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>

/** Feedback runs only after the host verifies an accepted edit. */
export interface CompletionProviderOptions {
  readonly onAccepted?: (
    request: CompletionRequest,
    item: CompletionItem,
  ) => void
}

/** Context after committed typing; change offsets refer to the previous editor document. */
export interface TypingContext extends Omit<CompletionRequest, 'trigger'> {
  readonly kind:
    | 'input'
    | 'delete'
    | 'undo'
    | 'redo'
    | 'composition'
    | 'replace'
  readonly change: {
    readonly from: number
    readonly to: number
    readonly insertedLength: number
  }
}

/** Prove source prose without scanning an entire document on each input. */
export function sourceProseAllowed(prefix: string) {
  // ponytail: proof covers the first 16 KiB; extend with incremental syntax state.
  if (prefix.length > 16384) return false
  const lines = prefix.split(/\r?\n/)
  let frontmatter = /^\uFEFF?---\s*$/.test(lines[0])
  let fence = ''
  let math = false
  for (let index = frontmatter ? 1 : 0; index < lines.length; index++) {
    const line = lines[index]
    if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false
      continue
    }
    const code = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (code && !math) {
      if (!fence) fence = code
      else if (code[0] === fence[0] && code.length >= fence.length) fence = ''
      continue
    }
    if (fence) continue
    if (/^\s*\$\$/.test(line)) {
      const delimiters = line.match(/(?<!\\)\$\$/g)?.length ?? 0
      if (delimiters % 2) math = !math
    }
  }
  return !frontmatter && !fence && !math
}

/** Clip plain context at syntax and sensitive tokens, preserving punctuation. */
export function safeCompletionContext(text: string, offset: number) {
  if (
    /(?:password|passwd|secret|token|api[_ -]?key|authorization|otp|pin)\s*[:=]/i.test(
      text,
    )
  )
    return null
  let from = Math.max(0, offset - 256)
  let to = Math.min(text.length, offset + 256)
  const exclude = (start: number, end: number, open = false) => {
    if (start < offset && (offset < end || (open && offset === end)))
      return false
    if (end <= offset) from = Math.max(from, end)
    if (start >= offset) to = Math.min(to, start)
    return true
  }
  for (const match of text.matchAll(
    /(`+|\$\$?)([\s\S]*?)(\1|$)|<[^>]*(?:>|$)|(?:https?:\/\/|www\.)[^\s]*|\b[^\s]{20,}\b/g,
  )) {
    const token = match[0]
    if (
      !match[1] &&
      !/^(?:<|https?:\/\/|www\.)/.test(token) &&
      !(/[a-z]/i.test(token) && /[\d_=/+]/.test(token))
    )
      continue
    if (
      !exclude(match.index, match.index + token.length, !!match[1] && !match[3])
    )
      return null
  }
  return { before: text.slice(from, offset), after: text.slice(offset, to) }
}

export interface CompletionUpdate {
  readonly request: CompletionRequest
  readonly items: readonly CompletionItem[]
  readonly done: boolean
}
