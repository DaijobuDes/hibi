import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ADDON_API_VERSION,
  type Addon,
  type AddonApp,
  type AddonCommand,
  type AddonContext,
  type AddonState,
  type MarkdownExtension,
  type RichExtension,
  type SourceExtension,
  type StatusItem,
} from '../../addons/api'
import { isMarkdownDocument } from '../../shared/document-types'
import { useDialogService } from '../../ui/DialogProvider'
import { menus } from '../../ui/menu-store'
import { useToastService } from '../../ui/Sonner'
import { createTooltipScope } from '../../ui/tooltip-store'
import { createAddonOverrides } from './addon-overrides'
import { addonRegistry } from './addon-registry'
import { codeLanguages } from './code-languages'
import { colorschemes } from './colorschemes'
import { documentFormats, editorDocument } from './document-formats'
import { onEditorInput, onEditorKeyEvent } from './editor-events'
import { explorerDecorations } from './explorer-decorations'
import { flavors, renderMarkdown, renderMarkdownAsync } from './flavors'
import { projectMarkdown } from './markdown'
import { toolbar } from './toolbar'

export { addons } from './addon-registry'

export type RegisteredCommand = AddonCommand & { addonId: string }
type Environment = Omit<
  AddonContext,
  | 'commands'
  | 'native'
  | 'editor'
  | 'statusBar'
  | 'app'
  | 'styles'
  | 'patches'
  | 'dialogs'
  | 'toasts'
  | 'notify'
  | 'workspace'
  | 'menus'
  | 'colorschemes'
  | 'toolbar'
  | 'tooltips'
> & {
  workspace: Omit<AddonContext['workspace'], 'registerDecorations'>
  invoke: (id: string, method: string, input?: unknown) => Promise<unknown>
  error: (error: unknown) => void
  updateMarkdown: AddonContext['editor']['updateMarkdown']
  runCommand: AddonContext['editor']['runCommand']
  runAction: AddonApp['runAction']
  getMarkdown: () => string
}

export function useAddons(environment: Environment) {
  const catalog = useSyncExternalStore(
    addonRegistry.subscribe,
    addonRegistry.snapshot,
  )
  const dialogService = useDialogService()
  const toastService = useToastService()
  const latest = useRef(environment)
  latest.current = environment
  const app = useRef<AddonApp>({
    runCommand: (command) => latest.current.runCommand(command),
    runAction: (command) => latest.current.runAction(command),
  }).current
  const [states, setStates] = useState<AddonState[]>([])
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [commands, setCommands] = useState<RegisteredCommand[]>([])
  const status = useRef(
    new Map<string, StatusItem & { addonId: string }>(),
  ).current
  const [statusItems, setStatusItems] = useState<StatusItem[]>([])
  const registered = useRef(new Map<string, RegisteredCommand>()).current
  const extensions = useRef(
    new Map<string, MarkdownExtension & { addonId: string }>(),
  ).current
  const [markdownExtensions, setMarkdownExtensions] = useState<
    MarkdownExtension[]
  >([])
  const rich = useRef(
    new Map<string, RichExtension & { addonId: string }>(),
  ).current
  const [richExtensions, setRichExtensions] = useState<RichExtension[]>([])
  const sources = useRef(
    new Map<string, SourceExtension & { addonId: string }>(),
  ).current
  const [sourceExtensions, setSourceExtensions] = useState<SourceExtension[]>(
    [],
  )
  const publishSources = useCallback(() => {
    setSourceExtensions((current) => {
      const next = [...sources.values()]
      return current.length === next.length &&
        current.every((entry, index) => entry === next[index])
        ? current
        : next
    })
  }, [sources])
  const publishExtensions = useCallback(() => {
    setMarkdownExtensions((current) => {
      const next = [...extensions.values()]
      return current.length === next.length &&
        current.every((entry, index) => entry === next[index])
        ? current
        : next
    })
  }, [extensions])
  const running = useRef(
    new Map<string, { addon: Addon; stop: () => void }>(),
  ).current
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const runtime of running.values()) runtime.stop()
    }
  }, [running])
  useEffect(() => {
    void Promise.all([
      window.hibi.getAddonStates(),
      window.hibi.getInstalledAddons(),
    ])
      .then(([states, installed]) => {
        setStates(states)
        addonRegistry.hydrate(installed)
        setLoaded(true)
      })
      .catch((error: unknown) => {
        latest.current.error(error)
        setReady(true)
      })
  }, [])
  useEffect(() => {
    if (!loaded) return
    for (const [id, runtime] of running) {
      if (
        !states.some((state) => state.id === id && state.enabled) ||
        !catalog.includes(runtime.addon)
      )
        runtime.stop()
    }
    for (const addon of catalog) {
      const id = addon.manifest.id
      if (
        running.has(id) ||
        !states.some((state) => state.id === id && state.enabled)
      )
        continue
      let disposed = false
      const overrides = createAddonOverrides(id)
      const dialogScope = dialogService.scope(addon.manifest.name)
      const toastScope = toastService.scope()
      const menuScope = menus.scope((error) => latest.current.error(error))
      const toolbarScope = toolbar.scope(id, (error) =>
        latest.current.error(error),
      )
      const tooltipScope = createTooltipScope()
      const cleanups = new Set<() => void>()
      const stop = () => {
        if (disposed) return
        disposed = true
        running.delete(id)
        for (const [key, command] of registered)
          if (command.addonId === id) registered.delete(key)
        for (const [key, extension] of extensions)
          if (extension.addonId === id) extensions.delete(key)
        for (const [key, extension] of sources)
          if (extension.addonId === id) sources.delete(key)
        for (const [key, extension] of rich)
          if (extension.addonId === id) rich.delete(key)
        if (mounted.current) setRichExtensions([...rich.values()])
        for (const [key, item] of status)
          if (item.addonId === id) status.delete(key)
        if (mounted.current) setStatusItems([...status.values()])
        if (mounted.current) publishExtensions()
        if (mounted.current) publishSources()
        try {
          try {
            addon.stop?.()
          } finally {
            for (const remove of cleanups) remove()
            cleanups.clear()
            dialogScope.dispose()
            toastScope.dispose()
            menuScope.dispose()
            toolbarScope.dispose()
            tooltipScope.dispose()
            overrides.dispose()
          }
        } catch (error) {
          latest.current.error(error)
        }
      }
      try {
        if (addon.manifest.apiVersion !== ADDON_API_VERSION)
          throw new Error(`incompatible addon: ${id}`)
        running.set(id, { addon, stop })
        const starting = addon.start({
          menus: menuScope.api,
          colorschemes: {
            register(scheme) {
              if (disposed) return () => {}
              if (!/^[a-z][a-z0-9-]*$/.test(scheme.id))
                throw new Error('invalid addon colorscheme id')
              const remove = colorschemes.register({
                ...scheme,
                id: `${id}.${scheme.id}`,
              })
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            list: () => colorschemes.snapshot().schemes,
            getPreferences: () => ({ ...colorschemes.snapshot().preferences }),
            setPreferences: (preferences) => {
              if (!disposed) colorschemes.set(preferences)
            },
          },
          dialogs: dialogScope.api,
          toasts: toastScope.api,
          toolbar: toolbarScope.api,
          tooltips: tooltipScope.api,
          app,
          styles: overrides.styles,
          patches: overrides.patches,
          statusBar: {
            register(initial) {
              if (disposed) return { update() {}, dispose() {} }
              const key = `${id}.${initial.id}`
              if (!/^[a-z][a-z0-9-]*$/.test(initial.id) || status.has(key))
                throw new Error(`duplicate or invalid status item: ${key}`)
              let active = true
              let item = initial
              const publish = () => {
                status.set(key, {
                  ...item,
                  id: key,
                  addonId: id,
                  ...(item.onClick
                    ? {
                        onClick: async () => {
                          if (!active || disposed) return
                          try {
                            await item.onClick?.()
                          } catch (error) {
                            latest.current.error(error)
                          }
                        },
                      }
                    : {}),
                })
                if (mounted.current) setStatusItems([...status.values()])
              }
              publish()
              return {
                update(changes) {
                  if (
                    !active ||
                    disposed ||
                    Object.entries(changes).every(
                      ([key, value]) => item[key as keyof StatusItem] === value,
                    )
                  )
                    return
                  item = { ...item, ...changes }
                  publish()
                },
                dispose() {
                  if (!active || disposed) return
                  active = false
                  status.delete(key)
                  if (mounted.current) setStatusItems([...status.values()])
                },
              }
            },
          },
          editor: {
            getDocument: () => editorDocument.get(),
            onDocumentChange(listener) {
              if (disposed) return () => {}
              const remove = editorDocument.subscribe((document) => {
                try {
                  listener(document)
                } catch (error) {
                  latest.current.error(error)
                }
              })
              cleanups.add(remove)
              return () => {
                remove()
                cleanups.delete(remove)
              }
            },
            registerDocumentFormat(format) {
              if (disposed) return () => {}
              const remove = documentFormats.register(
                id,
                format,
                addon.manifest.fileExtensions ?? [],
              )
              cleanups.add(remove)
              return () => {
                remove()
                cleanups.delete(remove)
              }
            },
            async renderDocument(source, name, documentId) {
              const format = documentFormats.get(name)
              if (format?.render) return format.render(source, documentId)
              if (!isMarkdownDocument(name))
                throw new Error(
                  `enable the extension for ${name} before exporting it.`,
                )
              return renderMarkdownAsync(
                projectMarkdown(source, [...extensions.values()]).content,
                documentId,
              )
            },
            registerCodeLanguage(language) {
              if (disposed) return () => {}
              const remove = codeLanguages.register(id, language)
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            registerFlavor(flavor) {
              if (disposed) return () => {}
              const remove = flavors.register(id, flavor)
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            renderMarkdown(source, documentId) {
              return renderMarkdown(
                projectMarkdown(source, [...extensions.values()]).content,
                documentId,
              )
            },
            onInput(listener) {
              if (disposed) return () => {}
              const remove = onEditorInput((event) => {
                if (disposed) return
                try {
                  listener(event)
                } catch (error) {
                  latest.current.error(error)
                }
              })
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            onKeyEvent(listener) {
              if (disposed) return () => {}
              const remove = onEditorKeyEvent((event) => {
                if (disposed) return
                try {
                  listener(event)
                } catch (error) {
                  latest.current.error(error)
                }
              })
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            registerRich(extension) {
              if (disposed) return () => {}
              const key = `${id}.${extension.id}`
              if (!/^[a-z][a-z0-9-]*$/.test(extension.id) || rich.has(key))
                throw new Error(`duplicate or invalid rich extension: ${key}`)
              rich.set(key, {
                id: key,
                addonId: id,
                attach(editor) {
                  if (disposed) return () => {}
                  try {
                    const detach = extension.attach(editor)
                    return () => {
                      try {
                        detach()
                      } catch (error) {
                        latest.current.error(error)
                      }
                    }
                  } catch (error) {
                    latest.current.error(error)
                    return () => {}
                  }
                },
              })
              if (mounted.current) setRichExtensions([...rich.values()])
              let active = true
              return () => {
                if (!active || disposed) return
                active = false
                if (rich.delete(key) && mounted.current)
                  setRichExtensions([...rich.values()])
              }
            },
            runCommand: (command) =>
              disposed ? Promise.resolve(false) : app.runCommand(command),
            registerSource(extension) {
              if (disposed) return () => {}
              const key = `${id}.${extension.id}`
              if (!/^[a-z][a-z0-9-]*$/.test(extension.id) || sources.has(key))
                throw new Error(`duplicate or invalid source extension: ${key}`)
              sources.set(key, {
                id: key,
                addonId: id,
                async create() {
                  if (disposed) return []
                  try {
                    const result = await extension.create()
                    return disposed ? [] : result
                  } catch (error) {
                    latest.current.error(error)
                    return []
                  }
                },
              })
              if (mounted.current) publishSources()
              return () => {
                sources.delete(key)
                if (!disposed && mounted.current) publishSources()
              }
            },
            updateMarkdown(transform, options) {
              if (!disposed) latest.current.updateMarkdown(transform, options)
            },
            registerMarkdown(extension) {
              if (disposed) return () => {}
              const key = `${id}.${extension.id}`
              if (
                !/^[a-z][a-z0-9-]*$/.test(extension.id) ||
                extensions.has(key)
              )
                throw new Error(
                  `duplicate or invalid markdown extension: ${key}`,
                )
              extensions.set(key, {
                id: key,
                addonId: id,
                ...(extension.Editor ? { Editor: extension.Editor } : {}),
                parse(source) {
                  if (disposed) return null
                  try {
                    return extension.parse(source)
                  } catch (error) {
                    queueMicrotask(() => latest.current.error(error))
                    return {
                      content: source,
                      serialize: () => source,
                      readOnly: true,
                    }
                  }
                },
              })
              if (mounted.current) publishExtensions()
              return () => {
                extensions.delete(key)
                if (!disposed && mounted.current) publishExtensions()
              }
            },
          },
          commands: {
            getSlashCommands() {
              if (disposed) return []
              const source = latest.current.getMarkdown()
              return [...registered.values()].flatMap(({ id, slash }) =>
                slash && (!slash.when || slash.when(source))
                  ? [{ ...slash, id }]
                  : [],
              )
            },
            register(command) {
              if (disposed) return () => {}
              const key = `${id}.${command.id}`
              if (!/^[a-z][a-z0-9-]*$/.test(command.id) || registered.has(key))
                throw new Error(`duplicate or invalid command: ${key}`)
              let active = true
              registered.set(key, {
                ...command,
                id: key,
                addonId: id,
                ...(command.slash
                  ? {
                      slash: {
                        ...command.slash,
                        when(source) {
                          if (!active || disposed) return false
                          try {
                            return command.slash?.when?.(source) ?? true
                          } catch (error) {
                            latest.current.error(error)
                            return false
                          }
                        },
                        transform(source) {
                          if (!active || disposed) return null
                          try {
                            return command.slash?.transform(source) ?? null
                          } catch (error) {
                            latest.current.error(error)
                            return null
                          }
                        },
                      },
                    }
                  : {}),
                run: async () => {
                  if (!active || disposed) return
                  try {
                    await command.run()
                  } catch (error) {
                    latest.current.error(error)
                  }
                },
              })
              if (mounted.current) setCommands([...registered.values()])
              return () => {
                if (!active || disposed) return
                active = false
                registered.delete(key)
                if (!disposed && mounted.current)
                  setCommands([...registered.values()])
              }
            },
          },
          workspace: {
            registerDecorations(provider) {
              if (disposed) return () => {}
              if (!/^[a-z][a-z0-9-]*$/.test(provider.id))
                throw new Error('invalid explorer provider id.')
              const remove = explorerDecorations.register(
                `${id}.${provider.id}`,
                provider,
              )
              const cleanup = () => {
                remove()
                cleanups.delete(cleanup)
              }
              cleanups.add(cleanup)
              return cleanup
            },
            snapshot: () =>
              disposed
                ? Promise.reject(new Error('addon is disabled.'))
                : latest.current.workspace.snapshot(),
            get: () => latest.current.workspace.get(),
            open: () =>
              disposed
                ? Promise.resolve(null)
                : latest.current.workspace.open(),
            openFile: (path) =>
              disposed
                ? Promise.resolve()
                : latest.current.workspace.openFile(path),
          },
          native: {
            query: <T>(method: string, input?: unknown) =>
              disposed
                ? Promise.reject(new Error('addon is disabled.'))
                : (window.hibi.queryAddon(id, method, input) as Promise<T>),
            invoke: <T>(method: string, input?: unknown) =>
              disposed
                ? Promise.reject(new Error('addon is disabled.'))
                : (latest.current.invoke(id, method, input) as Promise<T>),
          },
          notify: (message) => {
            if (!disposed) toastScope.api.show({ message })
          },
        })
        if (starting)
          void starting.catch((error: unknown) => {
            if (disposed) return
            stop()
            latest.current.error(error)
          })
      } catch (error) {
        stop()
        latest.current.error(error)
      }
    }
    setCommands([...registered.values()])
    setReady(true)
  }, [
    catalog,
    loaded,
    states,
    registered,
    running,
    extensions,
    publishExtensions,
    sources,
    publishSources,
    status,
    app,
    rich,
    dialogService,
    toastService,
  ])
  async function setEnabled(id: string, enabled: boolean) {
    try {
      setStates(await window.hibi.setAddonEnabled(id, enabled))
    } catch (error) {
      latest.current.error(error)
    }
  }
  async function install() {
    try {
      await window.hibi.installAddon()
      const [states, packages] = await Promise.all([
        window.hibi.getAddonStates(),
        window.hibi.getInstalledAddons(),
      ])
      setStates(states)
      addonRegistry.hydrate(packages)
    } catch (error) {
      latest.current.error(error)
    }
  }
  async function remove(id: string) {
    try {
      await window.hibi.removeAddon(id)
      const [states, packages] = await Promise.all([
        window.hibi.getAddonStates(),
        window.hibi.getInstalledAddons(),
      ])
      setStates(states)
      addonRegistry.hydrate(packages)
    } catch (error) {
      latest.current.error(error)
    }
  }
  return {
    catalog,
    ready,
    app,
    states,
    commands,
    markdownExtensions,
    richExtensions,
    sourceExtensions,
    statusItems,
    setEnabled,
    install,
    remove,
  }
}
