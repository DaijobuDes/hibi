import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  type ModuleNode,
  normalizePath,
  type Plugin,
  type ViteDevServer,
} from 'vite'
import { addonDevelopmentManifestContract } from '../src/shared/addon-development'
import type { AddonPackage } from './addon-packages'

/** Keep the previous inline CSS value without relying on browser URL aliases. */
export function addonDevelopmentStyles(): Plugin {
  return {
    name: 'addon-development-styles',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      if (
        !/[/\\\\]src[/\\\\](?:addons|useraddons)[/\\\\]/.test(id) ||
        !/\.css\?.*\b(?:inline|raw)\b/.test(id) ||
        !code.startsWith('export default ')
      )
        return
      return `${code.replace('export default ', 'const css = ')}
const previousCss = import.meta.hot.data.css ??= css
const applyCss = () => { import.meta.hot.data.css = css }
export { css as default, previousCss, applyCss }
`
    },
  }
}

// Shared with the main build: metadata updates do not replace native code.
export const developmentRestartFile = (root: string) =>
  resolve(root, 'out/.addon-restart')
export const developmentContract = (entry: AddonPackage) =>
  JSON.stringify([
    entry.native,
    entry.analysis,
    addonDevelopmentManifestContract(entry.manifest, Boolean(entry.native)),
  ])
export const developmentMetadata = new Set<string>()
export const developmentMainInputs = new Set<string>()

/** Use Vite's existing watcher; publish only a successfully transformed edit batch. */
export function addonDevelopment(
  server: ViteDevServer,
  sourceRoot: string,
  initial: AddonPackage[],
  read: () => Promise<AddonPackage[]>,
  refresh: (timestamp: number) => void,
) {
  const root = normalizePath(sourceRoot)
  const packages = new Map(initial.map((item) => [item.manifest.id, item]))
  server.watcher.add(initial.map((item) => resolve(root, item.directory)))
  const changes = new Map<string, { files: Set<string>; timestamp: number }>()
  const unapplied = new Map<string, { files: Set<string>; timestamp: number }>()
  server.ws.on(
    'hibi:addon-result',
    (result: { id?: string; revision?: number; status?: string }) => {
      if (
        result?.id &&
        (result.status === 'reloaded' || result.status === 'idle') &&
        unapplied.get(result.id)?.timestamp === result.revision
      )
        unapplied.delete(result.id)
    },
  )
  let timer: ReturnType<typeof setTimeout>
  let work = Promise.resolve()
  const url = (path: string) =>
    `/@fs/${normalizePath(resolve(path)).replace(/^\//, '')}`
  const version = (path: string, timestamp: number) =>
    timestamp ? `${path}${path.includes('?') ? '&' : '?'}t=${timestamp}` : path
  server.httpServer?.once('close', () => clearTimeout(timer))

  function failed(error: unknown) {
    server.config.logger.error(
      `addon update failed; keeping the running addon: ${error instanceof Error ? error.message : error}`,
    )
    server.ws.send({
      type: 'custom',
      event: 'hibi:addon-error',
      data: String(error),
    })
  }

  async function publish() {
    const batch = [...changes]
    changes.clear()
    try {
      const next = await read()
      if (
        next.length !== packages.size ||
        next.some((item) => !packages.has(item.manifest.id))
      ) {
        server.config.logger.warn(
          'addon folders changed; restart the development command',
        )
        return
      }
      for (const [id, { files, timestamp }] of batch) {
        try {
          const item = next.find((entry) => entry.manifest.id === id)
          const old = packages.get(id)
          if (!item || !old) continue
          if (developmentContract(item) !== developmentContract(old)) {
            await writeFile(developmentRestartFile(root), String(timestamp))
            packages.set(id, item)
            continue
          }
          for (const file of unapplied.get(id)?.files ?? []) files.add(file)
          unapplied.set(id, { files, timestamp })
          const scope = [...files].every(
            (file) => file.endsWith('.css') || item.themeFiles.includes(file),
          )
            ? 'styles'
            : 'code'
          const css = [...files]
            .filter((file) => file.endsWith('.css'))
            .flatMap((file) =>
              [...(server.moduleGraph.getModulesByFile(file) ?? [])]
                .filter(
                  (module) =>
                    !module.url.includes('?url') &&
                    !module.url.includes('?direct'),
                )
                .map((module) => ({
                  after: version(module.url, timestamp),
                })),
            )
          for (const file of files)
            for (const module of server.moduleGraph.getModulesByFile(file) ??
              [])
              server.moduleGraph.invalidateModule(
                module,
                new Set(),
                timestamp,
                true,
              )
          refresh(timestamp)
          const seen = new Set<ModuleNode>()
          const compile = async (path: string) => {
            await server.transformRequest(path)
            const module = await server.moduleGraph.getModuleByUrl(path)
            if (!module || seen.has(module)) return
            seen.add(module)
            for (const dependency of module.importedModules)
              if (dependency.file?.startsWith(`${root}/src/`))
                await compile(dependency.url)
          }
          const codeChanged =
            scope === 'code' &&
            [...files].some((file) => !developmentMetadata.has(file))
          for (const path of codeChanged
            ? [item.entry, item.settings, item.flavors]
            : [])
            if (path)
              await compile(version(url(resolve(root, path)), timestamp))
          for (const sheet of css) await server.transformRequest(sheet.after)
          const catalog = `virtual:hibi-addon-catalog/renderer?revision=${timestamp}`
          await server.transformRequest(catalog)
          const pending = changes.get(id)
          if (pending) {
            for (const file of files) pending.files.add(file)
            continue
          }
          packages.set(id, item)
          server.ws.send({
            type: 'custom',
            event: 'hibi:addon-update',
            data: {
              id,
              scope,
              revision: timestamp,
              contract: developmentContract(item),
              catalog: `/@id/__x00__${catalog}`,
              css,
            },
          })
        } catch (error) {
          failed(error)
        }
      }
    } catch (error) {
      for (const [id, change] of batch) {
        const pending = changes.get(id)
        if (pending) for (const file of change.files) pending.files.add(file)
        else changes.set(id, change)
      }
      failed(error)
    }
  }

  return (file: string, timestamp: number) => {
    const item = [...packages.values()].find((entry) =>
      file.startsWith(`${normalizePath(resolve(root, entry.directory))}/`),
    )
    if (!item) return false
    // Main owns guarded restarts for shared runtime inputs and documentation.
    if (
      developmentMainInputs.has(file) &&
      (!developmentMetadata.has(file) || file.endsWith('.md'))
    )
      return true
    if (
      !/\.[cm]?[jt]sx?$/.test(file) &&
      !file.endsWith('/hibi-addon.json') &&
      !file.endsWith('.css') &&
      !item.themeFiles.includes(file) &&
      !developmentMetadata.has(file) &&
      ![...(server.moduleGraph.getModulesByFile(file) ?? [])].some(
        (module) => module.importers.size,
      )
    )
      return true
    const pending = changes.get(item.manifest.id) ?? {
      files: new Set<string>(),
      timestamp,
    }
    pending.files.add(file)
    pending.timestamp = timestamp
    changes.set(item.manifest.id, pending)
    clearTimeout(timer)
    timer = setTimeout(() => {
      work = work.then(publish)
    }, 150)
    return true
  }
}
