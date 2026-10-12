import { app } from 'electron'

const testing = !app.isPackaged && app.commandLine.hasSwitch('hibi-test')

/** Tests hold a named step here to reach a race deterministically. Inert outside test runs. */
export function testPause(name: string): Promise<void> | undefined {
  if (!testing) return
  return (globalThis as { hibiTestPauses?: Record<string, Promise<void>> })
    .hibiTestPauses?.[name]
}
