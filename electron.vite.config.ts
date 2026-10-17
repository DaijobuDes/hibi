import { isAbsolute, relative, resolve, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { addonCatalog } from './scripts/addon-packages'
import { analysisBundles, sandboxPreloads } from './scripts/analysis-bundles'
import { writeLicenses } from './scripts/licenses'
import {
  diagnosticsBuild,
  diagnosticsDefines,
} from './scripts/local-diagnostics-build'
import { startupBundle } from './scripts/startup-bundle'

const diagnosticArtifacts = diagnosticsBuild()
const mainOutput = resolve('out/main')

let licenseBuild = Promise.resolve<PromiseSettledResult<void>[]>([])
const drainLicenses = {
  order: 'pre' as const,
  sequential: true,
  async handler() {
    await licenseBuild
  },
}

export default defineConfig({
  main: {
    define: diagnosticsDefines(),
    plugins: [
      addonCatalog('main'),
      {
        name: 'app-licenses',
        buildStart() {
          licenseBuild = Promise.allSettled([writeLicenses()])
        },
        buildEnd: {
          order: 'post',
          sequential: true,
          async handler() {
            const [result] = await licenseBuild
            if (result?.status === 'rejected') throw result.reason
          },
        },
        closeBundle: drainLicenses,
        closeWatcher: drainLicenses,
      },
      analysisBundles(),
    ],
    build: {
      // Development workers load installed compilers directly.
      externalizeDeps:
        process.env.NODE_ENV_ELECTRON_VITE === 'development'
          ? {
              include: [
                '@markdoc/markdoc',
                '@mdx-js/mdx',
                'hast-util-to-html',
                'mdast-util-to-hast',
                'mdsvex',
                'react',
                'react-dom',
                'remark-gfm',
                'svelte',
              ],
            }
          : true,
      // Keep old lazy chunks available until the dev watcher restarts Electron.
      emptyOutDir: process.env.NODE_ENV_ELECTRON_VITE !== 'development',
      // unzipper's optional S3 adapter must stay lazy; hibi only opens local buffers.
      commonjsOptions: { ignore: ['@aws-sdk/client-s3'] },
      rollupOptions: {
        watch: {
          chokidar: {
            ignored: (path: string) => {
              const part = relative(mainOutput, path)
              return (
                part === '' ||
                (part !== '..' &&
                  !part.startsWith(`..${sep}`) &&
                  !isAbsolute(part))
              )
            },
          },
        },
        input: {
          index: resolve('src/main/index.ts'),
          'typst-worker': resolve('src/addons/typst/compiler-worker.ts'),
          'format-worker': resolve('src/addons/_shared/format-worker.ts'),
          'dictionary-pack-worker': resolve(
            'src/addons/dictionary/pack-worker.ts',
          ),
        },
      },
    },
  },
  preload: {
    plugins: [sandboxPreloads()],
    build: {
      // Keep the last preload available to renderers reloading during a rebuild.
      emptyOutDir: process.env.NODE_ENV_ELECTRON_VITE !== 'development',
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [
      addonCatalog('renderer'),
      react(),
      startupBundle(),
      diagnosticArtifacts.renderer,
    ],
    worker: { format: 'es', plugins: () => [diagnosticArtifacts.worker()] },
    build: {
      target: 'chrome152',
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'addon-window': resolve('src/renderer/addon-window.html'),
        },
      },
    },
    server: { host: '127.0.0.1' },
  },
})
