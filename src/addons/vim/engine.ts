import { drawSelection, EditorView, ViewPlugin } from '@codemirror/view'
import { getCM, Vim, vim } from '@replit/codemirror-vim'
import type { AddonContext, StatusHandle } from '../api'
import { vimPreferences } from './Settings'

const contexts = new WeakMap<object, AddonContext>()

function commandArgument(params: { argString?: string }) {
  return (params.argString ?? '').trim()
}

function write(cm: { cm6: object }, close = false) {
  const context = contexts.get(cm.cm6)
  if (!context) return
  void context.editor.runCommand('save').then((saved) => {
    if (saved && close) window.close()
    else if (saved) context.notify('saved')
  })
}
Vim.defineEx('write', 'w', (cm, params) => {
  if (commandArgument(params))
    contexts.get(cm.cm6)?.notify('use save as to choose a new file name.')
  else write(cm)
})
Vim.defineEx('wq', 'wq', (cm) => write(cm, true))
Vim.defineEx('writequit', undefined, (cm) => write(cm, true))
Vim.defineEx('xit', 'x', (cm) => write(cm, true))
Vim.defineEx('quit', 'q', (cm) => {
  if (contexts.has(cm.cm6)) window.close()
})
Vim.defineEx('edit', 'e', (cm, params) => {
  const context = contexts.get(cm.cm6)
  if (!context) return
  const path = commandArgument(params).replaceAll('\\ ', ' ')
  if (path)
    void context.workspace
      .openFile(path)
      .catch((error: unknown) =>
        context.notify(
          error instanceof Error ? error.message : 'could not open file.',
        ),
      )
  else void context.editor.runCommand('open')
})
Vim.defineEx('enew', 'ene', (cm) => {
  void contexts.get(cm.cm6)?.editor.runCommand('new')
})

export function createVim(context: AddonContext) {
  return [
    vim(),
    drawSelection(),
    EditorView.editorAttributes.of({ 'data-vim-plugin': 'true' }),
    ViewPlugin.fromClass(
      class {
        cm: ReturnType<typeof getCM>
        status: StatusHandle
        disposed = false
        applyPreferences = () => {
          this.status.update({
            label: vimPreferences().status
              ? `vim · ${this.cm?.state.vim?.mode ?? 'normal'}`
              : '',
          })
        }
        labelDialog = () =>
          this.cm?.state.dialog
            ?.querySelector('input')
            ?.setAttribute('aria-label', 'vim command')
        constructor(readonly view: EditorView) {
          this.cm = null
          this.status = context.statusBar.register({
            id: 'mode',
            label: 'vim · normal',
            tooltip: 'vim mode in the markdown pane',
            when: 'source',
          })
          contexts.set(view, context)
          this.applyPreferences()
          window.addEventListener('hibi:vim-settings', this.applyPreferences)
          queueMicrotask(() => {
            if (this.disposed) return
            this.cm = getCM(view)
            this.cm?.on('dialog', this.labelDialog)
            this.cm?.on('vim-mode-change', this.applyPreferences)
            this.applyPreferences()
            if (this.cm && vimPreferences().insert)
              Vim.handleKey(this.cm, 'i', 'api')
          })
        }
        destroy() {
          this.disposed = true
          contexts.delete(this.view)
          this.cm?.off('dialog', this.labelDialog)
          this.cm?.off('vim-mode-change', this.applyPreferences)
          this.status.dispose()
          window.removeEventListener('hibi:vim-settings', this.applyPreferences)
        }
      },
    ),
  ]
}
