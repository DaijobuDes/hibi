import { CircleAlert, FileText, Network } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { AddonContext } from '../api'
import { Button, ControlRow, Panel, PanelMessage, TextInput } from '../ui'
import { useWorkspaceSnapshot } from '../workspace-snapshot'
import { GraphCanvas } from './Canvas'
import { noteGraph } from './model'

export function GraphPanel({
  context,
  expandedView = false,
  initialQuery = '',
}: {
  context: AddonContext
  expandedView?: boolean
  initialQuery?: string
}) {
  const { snapshot, workspace, loading, error } = useWorkspaceSnapshot(context)
  const [query, setQuery] = useState(initialQuery)
  const [expanded, setExpanded] = useState(false)
  const previous = useRef<ReturnType<typeof noteGraph> | null>(null)
  const full = useMemo(() => {
    const next = noteGraph(snapshot?.pages ?? [])
    const last = previous.current
    if (
      last &&
      last.nodes.length === next.nodes.length &&
      last.edges.length === next.edges.length &&
      last.nodes.every((node, index) => node.id === next.nodes[index]?.id) &&
      last.edges.every(
        (edge, index) =>
          edge.source === next.edges[index]?.source &&
          edge.target === next.edges[index]?.target,
      )
    )
      return last
    previous.current = next
    return next
  }, [snapshot])
  const connections = useMemo(() => {
    const neighbors = new Set<string>()
    for (const edge of full.edges)
      if (
        edge.source === workspace?.activePath ||
        edge.target === workspace?.activePath
      ) {
        neighbors.add(edge.source)
        neighbors.add(edge.target)
      }
    neighbors.delete(workspace?.activePath ?? '')
    return full.nodes.filter((node) => neighbors.has(node.id))
  }, [full, workspace?.activePath])
  const graph = useMemo(() => {
    const matching = full.nodes.filter((node) =>
      node.id.toLowerCase().includes(query.trim().toLowerCase()),
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
  }, [full, query])
  const open = (path: string) => {
    void context.workspace.openFile(path)
  }
  const expand = () => {
    setExpanded(true)
    const dialog = context.dialogs.open({
      title: 'Workspace graph',
      size: 'wide',
      content: () => (
        <GraphPanel context={context} expandedView initialQuery={query} />
      ),
    })
    void dialog.result.then(() => setExpanded(false))
  }
  return (
    <Panel className={`graph-panel${expandedView ? ' graph-modal' : ''}`}>
      <ControlRow className="graph-controls">
        <TextInput
          type="search"
          aria-label="Filter graph notes"
          placeholder="Filter notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </ControlRow>
      {error ? (
        <PanelMessage
          icon={<CircleAlert size={24} />}
          title="Graph unavailable"
          role="alert"
        >
          {error}
        </PanelMessage>
      ) : loading && !snapshot ? (
        <PanelMessage
          icon={<Network size={24} />}
          title="Reading workspace…"
          loading
        />
      ) : !workspace ? (
        <PanelMessage icon={<Network size={24} />} title="No workspace open">
          Open a workspace to explore connections between notes.
        </PanelMessage>
      ) : !full.nodes.length ? (
        <PanelMessage icon={<Network size={24} />} title="No notes yet">
          Add notes to this workspace to see them here.
        </PanelMessage>
      ) : (
        <>
          <p className="graph-summary" role="status">
            {graph.nodes.length} of {graph.total} notes · {graph.edges.length}{' '}
            {graph.edges.length === 1 ? 'connection' : 'connections'}
            {graph.total > 500 ? ' · filter to see more notes' : ''}
          </p>
          {expanded ? (
            <div className="graph-expanded-placeholder" />
          ) : graph.nodes.length ? (
            <GraphCanvas
              graph={graph}
              active={workspace.activePath}
              open={open}
              expand={expandedView ? undefined : expand}
            />
          ) : (
            <PanelMessage
              icon={<Network size={24} />}
              title="No matching notes"
            >
              Try another filter.
            </PanelMessage>
          )}
          {!expandedView && (
            <section className="graph-connections" aria-label="Connections">
              <h3>Connections</h3>
              {connections.length ? (
                connections.map((node) => (
                  <Button
                    key={node.id}
                    variant="row"
                    onClick={() => open(node.id)}
                  >
                    <FileText size={14} aria-hidden="true" />
                    <span title={node.id}>{node.id}</span>
                  </Button>
                ))
              ) : (
                <p>
                  {workspace.activePath
                    ? 'No links to this note yet.'
                    : 'Open a note to see its connections.'}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </Panel>
  )
}
