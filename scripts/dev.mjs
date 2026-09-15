import { fork, spawn } from 'node:child_process'
import { resolve } from 'node:path'

const site = fork(resolve('scripts/build-site.mjs'), ['--watch'], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
})
let desktop
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  desktop?.kill()
  site.kill()
  process.exitCode = code
}
site.once('message', () => {
  desktop = spawn(
    process.execPath,
    [
      resolve('node_modules/electron-vite/bin/electron-vite.js'),
      'dev',
      '--watch',
    ],
    { stdio: 'inherit' },
  )
  desktop.on('exit', (code) => stop(code ?? 0))
})
site.on('exit', (code) => stop(code ?? 0))
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
