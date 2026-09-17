import { useCallback, useEffect, useState } from 'react'
import type { AddonContext } from '../api'
import { Button, ControlRow, Panel, Select, TextInput } from '../ui'
import type { GitFile, GitState } from './types'
import './git.css'

export function GitPanel({ context }: { context: AddonContext }) {
  const [state, setState] = useState<GitState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null)
  const run = useCallback(
    async (method: string, input?: unknown) => {
      setBusy(true)
      setError('')
      try {
        setState(await context.native.invoke<GitState>(method, input))
        setDiff(null)
        if (method === 'commit') setMessage('')
      } catch (error) {
        setError(String(error))
      } finally {
        setBusy(false)
      }
    },
    [context],
  )
  useEffect(() => {
    void run('state')
  }, [run])
  async function preview(file: GitFile) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setDiff({
        path: file.path,
        text: await context.native.invoke<string>('diff', file.path),
      })
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel className="git-panel">
      <ControlRow className="git-actions">
        <Select
          aria-label="git branch"
          disabled={busy || !state}
          value={state ? `refs/heads/${state.branch}` : ''}
          onChange={(event) => void run('switch', event.target.value)}
        >
          {state && !state.branches.includes(`refs/heads/${state.branch}`) && (
            <option value={`refs/heads/${state.branch}`}>{state.branch}</option>
          )}
          {state?.branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch.replace(/^refs\/(heads|remotes)\//, '')}
            </option>
          ))}
        </Select>
        <Button disabled={busy} onClick={() => void run('state')}>
          refresh
        </Button>
        <Button disabled={busy || !state} onClick={() => void run('pull')}>
          pull{state?.behind ? ` (${state.behind})` : ''}
        </Button>
        <Button disabled={busy || !state} onClick={() => void run('push')}>
          push{state?.ahead ? ` (${state.ahead})` : ''}
        </Button>
      </ControlRow>
      {busy && <p role="status">working…</p>}
      {error && <p role="alert">{error}</p>}
      {state && (
        <>
          {!state.files.length && <p>working tree clean.</p>}
          <section className="git-files" aria-label="changed files">
            {state.files.map((file) => (
              <div className="git-file" key={file.path}>
                <Button
                  variant="row"
                  type="button"
                  disabled={busy}
                  aria-pressed={diff?.path === file.path}
                  onClick={() => void preview(file)}
                >
                  <code>
                    {file.index}
                    {file.worktree}
                  </code>
                  <span>{file.path}</span>
                </Button>
                <Button
                  disabled={
                    busy || (file.worktree === ' ' && file.index !== '?')
                  }
                  onClick={() => void run('stage', file.path)}
                >
                  stage
                </Button>
                <Button
                  disabled={busy || [' ', '?'].includes(file.index)}
                  onClick={() => void run('unstage', file.path)}
                >
                  unstage
                </Button>
              </div>
            ))}
          </section>
          {diff && (
            <section aria-label={`diff for ${diff.path}`}>
              <pre className="git-diff">{diff.text}</pre>
            </section>
          )}
          <form
            className="git-commit"
            onSubmit={(event) => {
              event.preventDefault()
              if (!busy && message.trim()) void run('commit', message)
            }}
          >
            <label htmlFor="git-message">commit staged changes</label>
            <TextInput
              id="git-message"
              placeholder="commit message"
              value={message}
              maxLength={8000}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              disabled={
                busy ||
                !message.trim() ||
                !state.files.some((file) => ![' ', '?'].includes(file.index))
              }
            >
              commit
            </Button>
          </form>
        </>
      )}
    </Panel>
  )
}
