import { indentUnit } from '@codemirror/language'
import { StateField, type Text } from '@codemirror/state'
import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

export const indentUnits = ['\t', '  ', '    '] as const
type Preferences = { enabled: boolean; unit: (typeof indentUnits)[number] }
const key = 'hibi:tab-indent'
let preferences: Preferences = { enabled: true, unit: '\t' }
try {
  const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
  preferences = {
    enabled: stored.enabled !== false,
    unit: indentUnits.includes(stored.unit) ? stored.unit : '\t',
  }
} catch {
  /* Use defaults if preferences are unavailable. */
}
const listeners = new Set<() => void>()
export const tabIndent = {
  snapshot: () => preferences,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  set(next: { enabled?: boolean; unit?: string }) {
    preferences = {
      enabled: next.enabled ?? preferences.enabled,
      unit: indentUnits.find((unit) => unit === next.unit) ?? preferences.unit,
    }
    localStorage.setItem(key, JSON.stringify(preferences))
    for (const listener of listeners) listener()
  },
}

const indented = /\t| {2,}(?=[^ \n])/y
/** The first indented line's unit, scanning only as far as that line. */
export function detectIndentUnit(text: string) {
  for (let at = 0; ; ) {
    indented.lastIndex = at
    const match = indented.exec(text)?.[0]
    if (match)
      return match === '\t' ? match : ' '.repeat(Math.min(match.length, 4))
    at = text.indexOf('\n', at) + 1
    if (!at) return undefined
  }
}

type Indented = { unit: string; from: number; to: number } | null
const firstIndented = (doc: Text, pos = 0, end = doc.length): Indented => {
  while (pos <= end) {
    const line = doc.lineAt(pos)
    const unit = detectIndentUnit(line.text)
    if (unit) return { unit, from: line.from, to: line.to }
    pos = line.to + 1
  }
  return null
}
/** Source view's first indented line, rescanned only when an edit reaches it. */
export const sourceIndent = StateField.define<Indented>({
  create: (state) => firstIndented(state.doc),
  update(found, { changes, docChanged, newDoc }) {
    if (!docChanged) return found
    if (found && changes.touchesRange(found.from, found.to))
      return firstIndented(newDoc)
    // Untouched lines keep their indentation, so only edited lines can precede it.
    let next = found && {
      ...found,
      from: changes.mapPos(found.from),
      to: changes.mapPos(found.to),
    }
    changes.iterChangedRanges((_fromA, _toA, from, to) => {
      next =
        firstIndented(newDoc, from, next ? Math.min(to, next.from - 1) : to) ??
        next
    })
    return next
  },
})

/** Source Tab and toolbar indentation: the file's own style, else the preferred unit. */
export const sourceIndentation = (preferred: string) => [
  sourceIndent,
  indentUnit.compute(
    [sourceIndent],
    (state) => state.field(sourceIndent)?.unit ?? preferred,
  ),
]

/** Rich-text Tab: lists and tables first, then code indentation, then a mid-line tab. */
export const TabIndent = Extension.create({
  name: 'tabIndent',
  // After list and table keymaps, which keep their own Tab behavior.
  priority: 50,
  addProseMirrorPlugins() {
    // Like CodeMirror: an Escape no menu used lets the next Tab within two seconds move focus.
    let until = 0
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key === 'Escape') until = Date.now() + 2000
            return false
          },
          handleDOMEvents: {
            keydown: (_view, event) => {
              const escaped = event.key === 'Tab' && Date.now() <= until
              if (
                !['Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(
                  event.key,
                )
              )
                until = 0
              return escaped
            },
          },
        },
      }),
    ]
  },
  addKeyboardShortcuts() {
    const press = (outdent: boolean) => () => {
      if (!this.editor.isEditable) return false
      const { state, view } = this.editor
      const { $from, $to, from, to } = state.selection
      const code = $from.parent.type.name === 'codeBlock'
      if (!code)
        for (let depth = $from.depth; depth > 0; depth--)
          if (['listItem', 'taskItem'].includes($from.node(depth).type.name))
            // Keep focus when an item cannot move farther.
            return true
      if (!tabIndent.snapshot().enabled) return false
      if (!$from.sameParent($to) || !$from.parent.isTextblock) return true
      const tr = state.tr
      if (code) {
        const start = $from.start()
        const text = $from.parent.textContent
        const unit = detectIndentUnit(text) ?? tabIndent.snapshot().unit
        if (!outdent && from === to) tr.insertText(unit, from)
        else {
          // One replacement for every line: per-line steps would each keep a whole-block copy.
          const head =
            from === start ? 0 : text.lastIndexOf('\n', from - start - 1) + 1
          let end = text.indexOf('\n', Math.max(head, to - start - 1))
          if (end < 0) end = text.length
          const width = unit === '\t' ? 4 : unit.length
          const leading = new RegExp(`^(?:\t| {1,${width}})`)
          // Characters each line gains, negative when outdenting.
          const lines = text
            .slice(head, end)
            .split('\n')
            .map((line) => ({
              line,
              delta: outdent
                ? -(leading.exec(line)?.[0].length ?? 0)
                : unit.length,
            }))
          if (lines.every(({ delta }) => !delta)) return true
          // Shift a position by the lines before it; never past its own line start.
          const map = (pos: number) => {
            let at = start + head,
              moved = pos
            for (const { line, delta } of lines) {
              if (pos < at) break
              moved += Math.max(delta, at - pos)
              at += line.length + 1
            }
            return moved
          }
          const { anchor, head: caret } = state.selection
          tr.insertText(
            lines
              .map(({ line, delta }) =>
                outdent ? line.slice(-delta) : unit + line,
              )
              .join('\n'),
            start + head,
            start + end,
          ).setSelection(TextSelection.create(tr.doc, map(anchor), map(caret)))
        }
      } else {
        // Leading whitespace would turn into an indented code block on save.
        const line = $from.parent
          .textBetween(0, $from.parentOffset, undefined, (leaf) =>
            leaf.type.name === 'hardBreak' ? '\n' : '\ufffc',
          )
          .split('\n')
          .at(-1)
        if (outdent || !/\S/.test(line ?? '')) return true
        tr.insertText('\t', from, to)
      }
      // A UI event is its own undo step, apart from typing and other Tabs.
      if (tr.docChanged)
        view.dispatch(tr.setMeta('uiEvent', 'indent').scrollIntoView())
      return true
    }
    return { Tab: press(false), 'Shift-Tab': press(true) }
  },
})
