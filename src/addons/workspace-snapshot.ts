import { useEffect, useState } from 'react'
import type { WorkspaceSnapshot, WorkspaceState } from '../shared/workspace'
import type { AddonContext } from './api'

/** Read-only panels share the host's bounded snapshot and draft-aware file access. */
export function useWorkspaceSnapshot(context: AddonContext) {
  const [revision, refresh] = useState(0)
  const [state, setState] = useState<{
    workspace: WorkspaceState | null
    snapshot: WorkspaceSnapshot | null
    loading: boolean
    error: string
  }>({ workspace: null, snapshot: null, loading: true, error: '' })
  useEffect(
    () => window.hibi.onWorkspaceChanged(() => refresh((value) => value + 1)),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly refreshes workspace contents.
  useEffect(() => {
    let active = true
    setState((value) => ({ ...value, loading: true, error: '' }))
    void (async () => {
      try {
        const workspace = await context.workspace.get()
        const snapshot = workspace ? await context.workspace.snapshot() : null
        if (active) setState({ workspace, snapshot, loading: false, error: '' })
      } catch (error) {
        if (active)
          setState((value) => ({
            ...value,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'could not read workspace.',
          }))
      }
    })()
    return () => {
      active = false
    }
  }, [context, revision])
  return { ...state, refresh: () => refresh((value) => value + 1) }
}
