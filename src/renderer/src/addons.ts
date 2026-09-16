import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useDialogService } from '../../ui/DialogProvider'
import { createAddonOverrides } from './addon-overrides'

export const addons = Object.values(
  import.meta.glob<Addon>(
    ['../../addons/*/index.{ts,tsx}', '../../useraddons/*/index.{ts,tsx}'],
    { eager: true, import: 'default' },
  ),
)
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
> & {
  invoke: (id: string, method: string, input?: unknown) => Promise<unknown>
  error: (error: unknown) => void
  updateMarkdown: AddonContext['editor']['updateMarkdown']
  runCommand: AddonContext['editor']['runCommand']
  runAction: AddonApp['runAction']
  getMarkdown: () => string
}

export function useAddons(environment: Environment) {
  const dialogService = useDialogService()
  const latest = useRef(environment)
  latest.current = environment
  const app = useRef<AddonApp>({
    runCommand: (command) => latest.current.runCommand(command),
    runAction: (command) => latest.current.runAction(command),
  }).current
  const [states, setStates] = useState<AddonState[]>([])
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
    void window.hibi
      .getAddonStates()
      .then(setStates)
      .catch((error: unknown) => latest.current.error(error))
  }, [])
  useEffect(() => {
    for (const [id, runtime] of running) {
      if (
        !states.some((state) => state.id === id && state.enabled) ||
        !addons.includes(runtime.addon)
      )
        runtime.stop()
    }
    for (const addon of addons) {
      const id = addon.manifest.id
      if (
        running.has(id) ||
        !states.some((state) => state.id === id && state.enabled)
      )
        continue
      let disposed = false
      const overrides = createAddonOverrides(id)
      const dialogScope = dialogService.scope(addon.manifest.name)
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
            dialogScope.dispose()
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
        addon.start({
          dialogs: dialogScope.api,
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
            get: () => latest.current.workspace.get(),
            open: () => latest.current.workspace.open(),
            openFile: (path) => latest.current.workspace.openFile(path),
          },
          native: {
            invoke: <T>(method: string, input?: unknown) =>
              latest.current.invoke(id, method, input) as Promise<T>,
          },
          notify: (message) => latest.current.notify(message),
        })
      } catch (error) {
        stop()
        latest.current.error(error)
      }
    }
    setCommands([...registered.values()])
  }, [
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
  ])
  async function setEnabled(id: string, enabled: boolean) {
    try {
      setStates(await window.hibi.setAddonEnabled(id, enabled))
    } catch (error) {
      latest.current.error(error)
    }
  }
  return {
    app,
    states,
    commands,
    markdownExtensions,
    richExtensions,
    sourceExtensions,
    statusItems,
    setEnabled,
  }
}
