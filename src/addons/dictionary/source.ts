import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { type EditorView, ViewPlugin } from '@codemirror/view'
import { type LookupTarget, wordAt } from './lookup'

export const trackSourceViews = (views: Set<EditorView>) =>
  ViewPlugin.define((view) => {
    views.add(view)
    return { destroy: () => views.delete(view) }
  })

export function sourceTarget(
  view: EditorView,
  from: number,
  to: number,
): LookupTarget | null {
  const { doc } = view.state
  const line = doc.lineAt(from)
  if (to > line.to) return null
  const found = wordAt(line.text, from - line.from, to - line.from)
  if (!found) return null
  const range = { from: line.from + found.from, to: line.from + found.to }
  return {
    word: found.word,
    replace(text) {
      if (view.state.doc !== doc) return false
      view.dispatch({
        changes: { ...range, insert: text },
        selection: { anchor: range.from + text.length },
        annotations: [
          isolateHistory.of('full'),
          Transaction.userEvent.of('input.replace'),
        ],
      })
      return true
    },
    focus: () => view.focus(),
  }
}
