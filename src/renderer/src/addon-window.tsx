import { type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Addon, AddonManifest, AddonWindowProps } from '../../addons/api'
import type {
  AddonWindowBridge,
  AddonWindowContext,
} from '../../shared/addon-windows'
import { errorMessage } from '../../shared/errors'
import { createColorschemeStore } from '../../ui/colorschemes'
import './styles.css'
import '../../ui/ui-case'

declare global {
  interface Window {
    hibiAddonWindow: AddonWindowBridge
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
const bridge = window.hibiAddonWindow
const root = createRoot(document.getElementById('root') as HTMLElement)
const request = async <T,>(pending: Promise<unknown>) => {
  try {
    return (await pending) as T
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

let context: AddonWindowContext | undefined

function show(children: ReactNode) {
  root.render(
    <StrictMode>
      <div className="addon-window">
        {context?.titleBar === 'hibi' && (
          <header className="addon-window-titlebar">{context.title}</header>
        )}
        <div className="addon-window-content">{children}</div>
      </div>
    </StrictMode>,
  )
}

async function render() {
  context = await bridge.context()
  const { addonId, id, input, platform } = context
  document.documentElement.dataset.platform = platform
  const path = Object.keys(manifests).find(
    (candidate) => manifests[candidate]?.id === addonId,
  )
  const directory = path?.slice(0, path.lastIndexOf('/'))
  const load =
    implementations[`${directory}/index.ts`] ??
    implementations[`${directory}/index.tsx`]
  const Content = load && (await load()).windows?.[id]
  if (!Content) throw new Error('This addon window is unavailable.')
  const props: AddonWindowProps = {
    input,
    native: {
      query: (method, value) => request(bridge.query(method, value)),
      invoke: (method, value) => request(bridge.invoke(method, value)),
    },
    close: () => window.close(),
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
