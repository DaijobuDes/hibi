import { createElement, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '../../src/ui/Controls'
import {
  DialogProvider,
  useDialogService,
  useDialogs,
} from '../../src/ui/DialogProvider'
import '../../src/renderer/src/styles.css'

function Harness() {
  const dialogs = useDialogs()
  const service = useDialogService()
  const [result, setResult] = useState('ready')
  useEffect(() => {
    const owner = service.scope('test addon')
    const other = service.scope('other addon')
    Object.assign(window, {
      dialogTest: { dialogs, owner, other, createElement, service },
    })
    return () => {
      owner.dispose()
      other.dispose()
    }
  }, [dialogs, service])
  return (
    <main>
      <Button
        onClick={async () =>
          setResult(
            JSON.stringify(
              await dialogs.prompt({
                title: 'name this note',
                label: 'name',
                defaultValue: 'draft',
                validate: (value) => (value.trim() ? null : 'enter a name.'),
              }),
            ),
          )
        }
      >
        open built-in prompt
      </Button>
      <Button
        onClick={async () =>
          setResult(
            String(
              await dialogs.confirm({
                title: 'continue?',
                description: 'confirm this action.',
                confirmLabel: 'continue',
              }),
            ),
          )
        }
      >
        open built-in confirm
      </Button>
      <output aria-label="dialog result">{result}</output>
    </main>
  )
}

const root = document.createElement('div')
document.body.append(root)
createRoot(root).render(
  <StrictMode>
    <DialogProvider>
      <Harness />
    </DialogProvider>
  </StrictMode>,
)
