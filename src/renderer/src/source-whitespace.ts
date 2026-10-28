import type { Text } from '@codemirror/state'
import type { SourceSnapshot } from '../../shared/source-buffer.ts'

/** The live session owns its snapshot; cached replicas must not retain disposed stores. */
const sources = new WeakMap<Text, WeakRef<SourceSnapshot>>()

export function bindSourceText(text: Text, source: SourceSnapshot): Text {
  sources.set(text, new WeakRef(source))
  return text
}

/** JavaScript whitespace (or spaces/tabs), unknown outside a source session. */
export function sourceWhitespace(
  text: Text,
  from: number,
  to = text.length,
  kind: 'whitespace' | 'horizontal' = 'whitespace',
) {
  const source = sources.get(text)?.deref()
  return source?.isWhitespace(
    source.editorToRaw(from)!,
    to === text.length ? source.utf16Length : source.editorToRaw(to)!,
    kind,
  )
}
