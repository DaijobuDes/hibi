import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { writeLicenses } from './scripts/licenses'
import { startupBundle } from './scripts/startup-bundle'

export default defineConfig({
  main: {
    plugins: [{ name: 'app-licenses', buildStart: writeLicenses }],
    build: {
      // unzipper's optional S3 adapter must stay lazy; hibi only opens local buffers.
      commonjsOptions: { ignore: ['@aws-sdk/client-s3'] },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'typst-worker': resolve('src/addons/typst/compiler-worker.ts'),
          'format-worker': resolve('src/addons/_shared/format-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [react(), startupBundle()],
    build: { target: 'chrome152', minify: 'esbuild' },
    server: { host: '127.0.0.1' },
  },
})
