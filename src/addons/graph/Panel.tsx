import { useMemo, useState } from 'react'
import { Button } from '../../ui/Controls'
import type { AddonContext } from '../api'
import { useWorkspaceSnapshot } from '../workspace-snapshot'
import { GraphCanvas } from './Canvas'
import { noteGraph } from './model'

export function GraphPanel({
  context,
  close,
}: {
  context: AddonContext
  close: () => void
}) {
  const { snapshot, workspace, loading, error, refresh } =
    useWorkspaceSnapshot(context)
  const [query, setQuery] = useState('')
  const [local, setLocal] = useState(false)
  const full = useMemo(() => noteGraph(snapshot?.pages ?? []), [snapshot])
  const graph = useMemo(() => {
    const neighbors = new Set([workspace?.activePath])
    for (const edge of full.edges)
      if (
        edge.source === workspace?.activePath ||
        edge.target === workspace?.activePath
      ) {
        neighbors.add(edge.source)
        neighbors.add(edge.target)
      }
    const matching = full.nodes.filter(
      (node) =>
        node.id.toLowerCase().includes(query.trim().toLowerCase()) &&
        (!local || neighbors.has(node.id)),
    )
    // ponytail: SVG caps at 500 visible notes; use a canvas renderer for larger simultaneous graphs.
    const nodes = matching.slice(0, 500),
      ids = new Set(nodes.map((node) => node.id))
    return {
      nodes,
      edges: full.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
      total: matching.length,
    }
  }, [full, query, local, workspace?.activePath])
  const open = (path: string) => {
    close()
    void context.workspace.openFile(path)
  }
  return (
    <div className="graph-panel">
      <div className="graph-controls">
        <input
          aria-label="filter graph notes"
          placeholder="filter notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          aria-pressed={local}
          disabled={!workspace?.activePath}
          onClick={() => setLocal((value) => !value)}
        >
          current note
        </Button>
        <Button onClick={refresh} disabled={loading}>
          refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">reading workspace…</p>
      ) : !workspace ? (
        <Button onClick={() => void context.workspace.open().then(refresh)}>
          open a folder
        </Button>
      ) : (
        <>
          <p className="graph-summary" role="status">
            {graph.nodes.length} of {graph.total} notes · {graph.edges.length}{' '}
            connections{graph.total > 500 ? ' · filter to see more notes' : ''}
          </p>
          {graph.nodes.length ? (
            <GraphCanvas
              graph={graph}
              active={workspace.activePath}
              open={open}
            />
          ) : (
            <p>no matching notes.</p>
          )}
          <p className="graph-help">
            click a note to open it. drag notes or the background; scroll to
            zoom.
          </p>
        </>
      )}
    </div>
  )
}
