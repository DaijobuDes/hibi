import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ADDON_API_VERSION,
  type Addon,
  type AddonCommand,
  type AddonContext,
  type AddonState,
  type MarkdownExtension,
} from '../../addons/api'

export const addons = Object.values(
  import.meta.glob<Addon>(
    ['../../addons/*/index.{ts,tsx}', '../../useraddons/*/index.{ts,tsx}'],
    { eager: true, import: 'default' },
  ),
)
export type RegisteredCommand = AddonCommand & { addonId: string }
type Environment = Omit<AddonContext, 'commands' | 'native' | 'editor'> & {
  invoke: (id: string, method: string, input?: unknown) => Promise<unknown>
  error: (error: unknown) => void
  updateMarkdown: AddonContext['editor']['updateMarkdown']
}

export function useAddons(environment: Environment) {
  const latest = useRef(environment)
  latest.current = environment
  const [states, setStates] = useState<AddonState[]>([])
  const [commands, setCommands] = useState<RegisteredCommand[]>([])
  const registered = useRef(new Map<string, RegisteredCommand>()).current
  const extensions = useRef(
    new Map<string, MarkdownExtension & { addonId: string }>(),
  ).current
  const [markdownExtensions, setMarkdownExtensions] = useState<
    MarkdownExtension[]
  >([])
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
      const stop = () => {
        disposed = true
        running.delete(id)
        for (const [key, command] of registered)
          if (command.addonId === id) registered.delete(key)
        for (const [key, extension] of extensions)
          if (extension.addonId === id) extensions.delete(key)
        if (mounted.current) publishExtensions()
        try {
          addon.stop?.()
        } catch (error) {
          latest.current.error(error)
        }
      }
      try {
        if (addon.manifest.apiVersion !== ADDON_API_VERSION)
          throw new Error(`incompatible addon: ${id}`)
        running.set(id, { addon, stop })
        addon.start({
          editor: {
            updateMarkdown(transform) {
              if (!disposed) latest.current.updateMarkdown(transform)
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
            register(command) {
              if (disposed) return () => {}
              const key = `${id}.${command.id}`
              if (!/^[a-z][a-z0-9-]*$/.test(command.id) || registered.has(key))
                throw new Error(`duplicate or invalid command: ${key}`)
              registered.set(key, {
                ...command,
                id: key,
                addonId: id,
                run: async () => {
                  if (disposed) return
                  try {
                    await command.run()
                  } catch (error) {
                    latest.current.error(error)
                  }
                },
              })
              if (mounted.current) setCommands([...registered.values()])
              return () => {
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
  }, [states, registered, running, extensions, publishExtensions])
  async function setEnabled(id: string, enabled: boolean) {
    try {
      setStates(await window.hibi.setAddonEnabled(id, enabled))
    } catch (error) {
      latest.current.error(error)
    }
  }
  return { states, commands, markdownExtensions, setEnabled }
}
