import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Accept local paths and file URLs from OS launchers, never remote URLs. */
export function externalFileArguments(
  argv: readonly string[],
  cwd: string,
  development: boolean,
): string[] {
  const paths: string[] = []
  let positional = false
  const args = argv.slice(development ? 2 : 1)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (!positional && arg === '--') {
      positional = true
      continue
    }
    if (!positional && arg.startsWith('-')) {
      if (
        [
          '--user-data-dir',
          '--remote-debugging-port',
          '--inspect',
          '--inspect-brk',
          '--log-file',
          '--js-flags',
          '--disk-cache-dir',
        ].includes(arg)
      )
        index += 1
      continue
    }
    if (arg.includes('\0')) continue
    if (arg.startsWith('file://')) {
      try {
        const url = new URL(arg)
        if (!url.hostname || url.hostname === 'localhost')
          paths.push(fileURLToPath(url))
      } catch {
        /* Ignore malformed file URLs from a launcher. */
      }
    } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(arg))
      paths.push(resolve(cwd, arg))
  }
  return [...new Set(paths)]
}
