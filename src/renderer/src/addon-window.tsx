import { lazy, type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  Addon,
  AddonManifest,
  AddonWindowEditorProps,
  AddonWindowProps,
} from '../../addons/api'
import type {
  AddonWindowBridge,
  AddonWindowContext,
  AddonWindowGlobal,
} from '../../shared/addon-windows'
import { errorMessage } from '../../shared/errors'
import {
  activePaletteKey,
  applyActivePalette,
  createColorschemeStore,
} from '../../ui/colorschemes'
import './styles.css'
import { windowDesktop } from './window-desktop'
import '../../ui/ui-case'

declare global {
  interface Window {
    hibiAddonWindow: AddonWindowGlobal
  }
}

// Only compiled addons can provide window content; this renderer never calls start().
const manifests = import.meta.glob<AddonManifest>(
  ['../../addons/*/manifest.ts', '../../useraddons/*/manifest.ts'],
  { eager: true, import: 'default' },
)
const implementations = import.meta.glob<Addon>(
  ['../../addons/*/index.{ts,tsx}', '../../useraddons/*/index.{ts,tsx}'],
  { import: 'default' },
)

// Same origin as the main window, so appearance follows its saved choice.
createColorschemeStore('hibi-colorscheme').start()
// The main window's resolved palette wins, so addon colorschemes apply here too.
const palette = document.createElement('style')
document.head.append(palette)
applyActivePalette(palette)
window.addEventListener('storage', (event) => {
  if (event.key === activePaletteKey) applyActivePalette(palette)
})
// "Match system" keeps following the system after the main window closes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () =>
  applyActivePalette(palette),
)
let bridge: AddonWindowBridge = window.hibiAddonWindow
const root = createRoot(document.getElementById('root') as HTMLElement)
const request = async <T,>(pending: Promise<unknown>) => {
  try {
    return (await pending) as T
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

let context: AddonWindowContext | undefined
// The editor host's modules expect window.hibi; give them a privilege-free stand-in.
const Editor = lazy(async () => {
  // Other addons start in this renderer next; keep the owner's bridge out of their reach.
  const owned = window.hibiAddonWindow.seal()
  if (!owned) throw new Error('This addon window is unavailable.')
  bridge = owned
  Object.defineProperty(window, 'hibi', {
    value: windowDesktop(bridge),
    configurable: true,
  })
  const { WindowEditor } = await import('./WindowEditor')
  return {
    default: (props: AddonWindowEditorProps) => (
      <WindowEditor {...props} subscribeStates={owned.onStates} />
    ),
  }
})

function show(children: ReactNode) {
  root.render(
    <StrictMode>
      <div className="app addon-window" data-platform={context?.platform}>
        {context?.titleBar === 'hibi' && (
          <header className="titlebar addon-window-titlebar">
            <div className="document-title">
              <span>{context.title}</span>
            </div>
          </header>
        )}
        <div className="addon-window-content">{children}</div>
      </div>
    </StrictMode>,
  )
}

async function render() {
  context = await bridge.context()
  const { addonId, id, input } = context
  const path = Object.keys(manifests).find(
    (candidate) => manifests[candidate]?.id === addonId,
  )
  const directory = path?.slice(0, path.lastIndexOf('/'))
  const load =
    implementations[`${directory}/index.ts`] ??
    implementations[`${directory}/index.tsx`]
  const windows = load && (await load()).windows
  // Only own keys: an id such as "constructor" must not reach Object.prototype.
  const Content =
    windows && Object.hasOwn(windows, id) ? windows[id] : undefined
  if (!Content) throw new Error('This addon window is unavailable.')
  const props: AddonWindowProps = {
    input,
    native: {
      query: (method, value) => request(bridge.query(method, value)),
      invoke: (method, value) => request(bridge.invoke(method, value)),
    },
    close: () => void bridge.close(),
    Editor,
  }
  show(<Content {...props} />)
}

render().catch((error: unknown) =>
  show(
    <p role="alert" className="addon-window-error">
      {errorMessage(error)}
    </p>,
  ),
)
