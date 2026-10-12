import {
  type ComponentType,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { AddonWindowEditorProps } from '../../addons/api'
import type { DocumentState } from '../../shared/desktop'
import { DialogProvider } from '../../ui/DialogProvider'
import { MenuHost } from '../../ui/MenuHost'
import { ToastProvider } from '../../ui/Sonner'
import { ActiveDocumentEditor } from './ActiveDocumentEditor'
import { useAddons } from './addons'
import { documentFormats, editorDocument } from './document-formats'
import { documentRuntime } from './document-runtime'
import type { MarkdownEditor } from './Editor'
import { loadCursor } from './EditorCursor'
import { EditorToolbar } from './EditorToolbar'
import { flavors, loadFlavor, selectedFlavors } from './flavors'
import { LoadingScreen } from './LoadingScreen'
import './colorschemes'

const name = 'Untitled.md'
const unavailable = () =>
  Promise.reject(new Error('This is not available in this window.'))

/** One untitled Markdown document, edited with Hibi's editor and the enabled editor addons. */
function Host({
  defaultValue = '',
  onChange,
  label = 'Note',
}: AddonWindowEditorProps) {
  const [document] = useState(() => {
    const initial: DocumentState = {
      tabId: `window-${crypto.randomUUID()}`,
      tabs: [],
      tabsEnabled: false,
      id: '',
      ephemeral: true,
      markdown: defaultValue,
      savedMarkdown: defaultValue,
      name,
      dirty: false,
      revision: 1,
      contentVersion: 0,
      canAutosave: false,
    }
    documentRuntime.activate(initial)
    return documentRuntime.get(initial.tabId) ?? initial
  })
  const current = useSyncExternalStore(
    documentRuntime.subscribe,
    () => documentRuntime.get(document.tabId) ?? document,
  )
  useEffect(() => {
    editorDocument.publish(current)
    onChange?.(current.markdown)
  }, [current, onChange])
  const host = useAddons(
    {
      openDependencySettings: () => {},
      workspace: {
        index: unavailable,
        snapshot: unavailable,
        get: async () => null,
        open: async () => null,
        openFile: async () => {},
      },
      invoke: unavailable,
      error: (error) => console.error(error),
      isBusy: () => false,
      updateMarkdown: () => {
        throw new Error('This is not available in this window.')
      },
      runCommand: async () => false,
      runAction: () => {},
      getMarkdown: () => documentRuntime.get(document.tabId)?.markdown ?? '',
      openSidebar: () => {},
      closeSidebar: () => {},
      openTab: () => {},
      focusDocument: async () => true,
    },
    name,
    'normal',
  )
  useSyncExternalStore(documentFormats.subscribe, documentFormats.snapshot)
  const available = useSyncExternalStore(flavors.subscribe, flavors.snapshot)
  const [choice] = useState(() => loadFlavor())
  const chosen = useMemo(
    () => selectedFlavors(choice, available),
    [choice, available],
  )
  const known = useMemo(
    () =>
      host.catalog.flatMap((addon) =>
        (addon.flavors ?? []).map((flavor) => ({
          ...flavor,
          id: `${addon.manifest.id}.${flavor.id}`,
          addonId: addon.manifest.id,
        })),
      ),
    [host.catalog],
  )
  const enabled = useMemo(
    () =>
      new Set(
        host.states.filter((state) => state.enabled).map((state) => state.id),
      ),
    [host.states],
  )
  const [Editor, setEditor] = useState<typeof MarkdownEditor>()
  useEffect(() => {
    void import('./Editor').then(({ MarkdownEditor }) =>
      setEditor(() => MarkdownEditor),
    )
  }, [])
  const [settings] = useState(() => ({
    cursor: loadCursor(),
    lineNumbers: localStorage.getItem('line-numbers') === 'true',
    spellCheck: localStorage.getItem('spell-check') !== 'false',
    markers: localStorage.getItem('markdown-markers') !== 'false',
  }))
  return (
    <div className="editor-surface">
      <EditorToolbar mode="normal" />
      <section
        className="editor-page"
        aria-label={label}
        inert={!host.ready}
        aria-busy={!host.ready}
      >
        {!Editor || !host.ready ? (
          <LoadingScreen />
        ) : (
          <Suspense fallback={<LoadingScreen />}>
            <ActiveDocumentEditor
              Component={Editor}
              markdown
              knownFlavors={known}
              chosenFlavors={chosen}
              flavorChoice={choice}
              manifests={host.catalog.map((addon) => addon.manifest)}
              enabledAddons={enabled}
              onFlavorStatus={() => {}}
              onOutline={() => {}}
              outlineActive={false}
              onActiveOutline={() => {}}
              outlineTarget={null}
              document={current}
              format={documentFormats.get(name)}
              formatName="Markdown"
              onAttach={async () => null}
              onLink={() => {}}
              flavors={chosen}
              footnoteDocument={false}
              sourceExtensions={host.sourceExtensions}
              richExtensions={host.richExtensions}
              documentRevision={current.revision}
              showLineNumbers={settings.lineNumbers}
              spellCheck={settings.spellCheck}
              showMarkdownMarkers={settings.markers}
              cursorSettings={settings.cursor}
              markdownExtensions={host.markdownExtensions}
              onChange={(value, group) =>
                documentRuntime.replace(value, 'visual', group, document.tabId)
              }
              mode="normal"
              disabled={false}
              findOpen={false}
              onCloseFind={() => {}}
            />
          </Suspense>
        )}
      </section>
      <MenuHost />
    </div>
  )
}

export const WindowEditor: ComponentType<AddonWindowEditorProps> = (props) => (
  <ToastProvider>
    <DialogProvider>
      <Host {...props} />
    </DialogProvider>
  </ToastProvider>
)
