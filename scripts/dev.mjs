import { fork, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { electronEnvironment } from './electron-runtime.mjs'

const environment = electronEnvironment().catch((error) => {
  console.error(error)
  stop(1)
})

const site = fork(resolve('scripts/build-site.mjs'), ['--watch'], {
  execArgv: ['--watch', '--watch-preserve-output'],
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
})
const docs = spawn(
  process.execPath,
  [
    '--watch',
    '--watch-preserve-output',
    resolve('scripts/docs.mjs'),
    '--watch',
  ],
  {
    stdio: 'inherit',
  },
)
let desktop
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  desktop?.kill()
  docs.kill()
  site.kill()
  process.exitCode = code
}
site.on('message', async (message) => {
  if (!message?.ready || desktop || stopping) return
  try {
    const env = await environment
    if (desktop || stopping) return
    desktop = spawn(
      process.execPath,
      [
        resolve('node_modules/electron-vite/bin/electron-vite.js'),
        'dev',
        '--watch',
        ...process.argv.slice(2),
      ],
      { stdio: 'inherit', env },
    )
    desktop.on('exit', (code) => stop(code ?? 0))
  } catch (error) {
    console.error(error)
    stop(1)
  }
})
site.on('exit', (code) => stop(code ?? 0))
docs.on('exit', (code) => stop(code ?? 0))
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
