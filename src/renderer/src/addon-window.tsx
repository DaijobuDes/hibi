import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Addon, AddonManifest, AddonWindowProps } from '../../addons/api'
import type { AddonWindowBridge } from '../../shared/addon-windows'
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

async function render() {
  const { addonId, id, input } = await bridge.context()
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
  root.render(
    <StrictMode>
      <Content {...props} />
    </StrictMode>,
  )
}

render().catch((error: unknown) =>
  root.render(
    <p role="alert" className="addon-window-error">
      {errorMessage(error)}
    </p>,
  ),
)
