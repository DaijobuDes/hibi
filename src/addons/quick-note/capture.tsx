import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../renderer/src/styles.css'
import { errorMessage } from '../../shared/errors'
import { createColorschemeStore } from '../../ui/colorschemes'
import '../../ui/ui-case'
import { CaptureWindow } from './CaptureWindow'
import type { QuickNoteBridge } from './ipc'
import { readSettings, settingsKey } from './settings'

declare global {
  interface Window {
    quickNote: QuickNoteBridge
  }
}

// Same origin as the main window, so theme and settings follow its storage.
createColorschemeStore('hibi-colorscheme').start()

function App() {
  const [settings, setSettings] = useState(readSettings)
  const [destination, setDestination] = useState<
    { id: string; path: string } | { error: string } | null
  >(null)
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === settingsKey) setSettings(readSettings())
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    let active = true
    window.quickNote.destination(settings.workspaceId).then(
      (target) => active && setDestination(target),
      (error) => active && setDestination({ error: errorMessage(error) }),
    )
    return () => {
      active = false
    }
  }, [settings.workspaceId])
  return (
    <CaptureWindow
      settings={settings}
      destination={destination}
      save={async (title, markdown) =>
        (
          await window.quickNote.save({
            workspaceId:
              destination && 'id' in destination ? destination.id : '',
            folder: settings.folder,
            title,
            markdown,
          })
        ).name
      }
    />
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
