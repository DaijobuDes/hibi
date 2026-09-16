import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { writeLicenses } from './scripts/licenses'

export default defineConfig({
  main: { plugins: [{ name: 'app-licenses', buildStart: writeLicenses }] },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
    build: { target: 'chrome152', minify: 'esbuild' },
    server: { host: '127.0.0.1' },
  },
})
