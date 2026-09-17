import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { electronEnvironment } from './electron-runtime.mjs'

const preview = spawn(
  process.execPath,
  [resolve('node_modules/electron-vite/bin/electron-vite.js'), 'preview'],
  {
    stdio: 'inherit',
    env: await electronEnvironment(),
  },
)
preview.on('exit', (code) => {
  process.exitCode = code ?? 0
})
process.once('SIGINT', () => preview.kill())
process.once('SIGTERM', () => preview.kill())
