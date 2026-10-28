import * as nativeCommands from '@codemirror/commands'
import type { Transaction } from '@codemirror/state'
import {
  runSourceHistory,
  sourceHistoryDepth,
} from '../shared/source-history.ts'

const undo: typeof nativeCommands.undo = (view) =>
  runSourceHistory(view, 'undo') ?? nativeCommands.undo(view)
const redo: typeof nativeCommands.redo = (view) =>
  runSourceHistory(view, 'redo') ?? nativeCommands.redo(view)
/** Keep select-all intent distinct from a text range with the same endpoints. */
const selectAll: typeof nativeCommands.selectAll = ({ state, dispatch }) => {
  dispatch(
    state.update({
      selection: { anchor: 0, head: state.doc.length },
      userEvent: 'select.all',
    }),
  )
  return true
}
/** A host view keeps native selection steps; its text history is its session's. */
const selectionHistory =
  (
    direction: 'undo' | 'redo',
    native: typeof nativeCommands.undoSelection,
  ): typeof native =>
  (target) => {
    let step: Transaction | undefined
    native({
      state: target.state,
      dispatch: (transaction) => {
        step = transaction
      },
    })
    if (!step || step.docChanged) {
      const done = runSourceHistory(target, direction)
      if (done !== undefined) return done
    }
    if (!step) return false
    target.dispatch(step)
    return true
  }
const undoSelection = selectionHistory('undo', nativeCommands.undoSelection)
const redoSelection = selectionHistory('redo', nativeCommands.redoSelection)
const hosted = new Map<unknown, typeof undo>([
  [nativeCommands.undo, undo],
  [nativeCommands.redo, redo],
  [nativeCommands.undoSelection, undoSelection],
  [nativeCommands.redoSelection, redoSelection],
  [nativeCommands.selectAll, selectAll],
])
const hostedKeymap = (bindings: typeof nativeCommands.defaultKeymap) =>
  bindings.map((binding) => ({
    ...binding,
    ...(binding.run ? { run: hosted.get(binding.run) ?? binding.run } : {}),
    ...(binding.shift
      ? { shift: hosted.get(binding.shift) ?? binding.shift }
      : {}),
  }))
export const commands = {
  ...nativeCommands,
  undo,
  redo,
  undoSelection,
  redoSelection,
  selectAll,
  undoDepth: (state: Parameters<typeof nativeCommands.undoDepth>[0]) =>
    sourceHistoryDepth(state, 'undo') ?? nativeCommands.undoDepth(state),
  redoDepth: (state: Parameters<typeof nativeCommands.redoDepth>[0]) =>
    sourceHistoryDepth(state, 'redo') ?? nativeCommands.redoDepth(state),
  historyKeymap: hostedKeymap(nativeCommands.historyKeymap),
  defaultKeymap: hostedKeymap(nativeCommands.defaultKeymap),
  standardKeymap: hostedKeymap(nativeCommands.standardKeymap),
}
export * as language from '@codemirror/language'
export * as state from '@codemirror/state'
export * as view from '@codemirror/view'
export * as highlight from '@lezer/highlight'
