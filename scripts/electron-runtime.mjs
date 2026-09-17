import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)

/** Keep Electron's installed/signed bundle intact; brand an owned development copy. */
export async function electronEnvironment() {
  if (process.platform !== 'darwin') return process.env
  const icon = resolve('build/icon.icns')
  const hash = createHash('sha256')
    .update(await readFile(icon))
    .digest('hex')
    .slice(0, 12)
  const version = require('electron/package.json').version
  const cache = resolve(`node_modules/.cache/hibi-electron/${version}-${hash}`)
  const bundle = join(cache, 'hibi.app')
  const ready = join(cache, 'ready')
  if ((await readFile(ready, 'utf8').catch(() => '')) !== 'ready') {
    await mkdir(cache, { recursive: true })
    const temporary = join(cache, `hibi-${process.pid}.app`)
    try {
      const original = resolve(dirname(require('electron')), '../..')
      await cp(original, temporary, {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      })
      const plist = join(temporary, 'Contents/Info.plist')
      for (const [key, value] of Object.entries({
        CFBundleName: 'hibi',
        CFBundleDisplayName: 'hibi',
        CFBundleIdentifier: 'com.ryanaque.hibi.dev',
        CFBundleIconFile: 'hibi.icns',
      }))
        await execute('plutil', ['-replace', key, '-string', value, plist])
      await cp(icon, join(temporary, 'Contents/Resources/hibi.icns'))
      await execute('codesign', ['--force', '--deep', '--sign', '-', temporary])
      await rename(temporary, bundle)
      await writeFile(ready, 'ready')
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  return {
    ...process.env,
    ELECTRON_EXEC_PATH: join(bundle, 'Contents/MacOS/Electron'),
  }
}
