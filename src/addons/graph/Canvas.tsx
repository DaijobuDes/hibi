/** biome-ignore-all lint/a11y/useSemanticElements: SVG graph nodes implement keyboard-accessible buttons within the SVG coordinate system. */
/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: the SVG canvas supports keyboard panning and must be focusable. */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force'
import { Focus, Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../ui/Controls'
import type { noteGraph } from './model'

type Node = ReturnType<typeof noteGraph>['nodes'][number] & SimulationNodeDatum
type Edge = { source: Node; target: Node }
type View = { x: number; y: number; scale: number; centered: string | null }

function cameraPosition(view: View, nodes: Node[]) {
  const node = nodes.find((node) => node.id === view.centered)
  return node
    ? { x: -(node.x ?? 0) * view.scale, y: -(node.y ?? 0) * view.scale }
    : { x: view.x, y: view.y }
}
export function GraphCanvas({
  graph,
  active,
  open,
  expand,
}: {
  graph: ReturnType<typeof noteGraph>
  active: string | null
  open: (path: string) => void
  expand?: (() => void) | undefined
}) {
  const svg = useRef<SVGSVGElement>(null)
  const simulation = useRef<Simulation<Node, undefined> | null>(null)
  const [size, setSize] = useState({ width: 640, height: 400 })
  const [view, setView] = useState<View>({
    x: 0,
    y: 0,
    scale: 1,
    centered: active,
  })
  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  })
  const drag = useRef<{
    pointer: number
    x: number
    y: number
    startX: number
    startY: number
    moved: boolean
    node: Node | undefined
  } | null>(null)
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const resize = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    )
    resize.observe(element)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      const x = event.clientX - bounds.left - bounds.width / 2
      const y = event.clientY - bounds.top - bounds.height / 2
      setView((old) => {
        const scale = Math.max(
          0.15,
          Math.min(4, old.scale * Math.exp(-event.deltaY * 0.002)),
        )
        const position = cameraPosition(old, simulation.current?.nodes() ?? [])
        return {
          scale,
          centered: null,
          x: x - ((x - position.x) * scale) / old.scale,
          y: y - ((y - position.y) * scale) / old.scale,
        }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      element.removeEventListener('wheel', wheel)
    }
  }, [])
  useEffect(() => {
    const nodes: Node[] = graph.nodes.map((node) => ({ ...node }))
    const links = graph.edges.map((edge) => ({ ...edge }))
    const engine = forceSimulation(nodes)
      .force(
        'links',
        forceLink<Node, { source: string; target: string }>(links)
          .id((node) => node.id)
          .distance(85),
      )
      .force('charge', forceManyBody().strength(-180))
      .force('collide', forceCollide(22))
      .force('center', forceCenter())
    simulation.current = engine
    const publish = () =>
      setLayout({ nodes: [...nodes], edges: links as unknown as Edge[] })
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      engine.stop()
      engine.tick(160)
      publish()
    } else {
      engine.on('tick', publish)
      publish()
    }
    setView((old) => ({
      x: 0,
      y: 0,
      centered: old.centered,
      scale: Math.min(1, 8 / Math.sqrt(Math.max(1, nodes.length))),
    }))
    return () => {
      engine.stop()
      simulation.current = null
    }
  }, [graph])
  useEffect(() => {
    setView((old) => ({ ...old, centered: active }))
  }, [active])
  const position = cameraPosition(view, layout.nodes)
  function activate(node: Node) {
    setView((old) => ({ ...old, centered: node.id }))
    open(node.id)
  }
  function fit() {
    if (!layout.nodes.length) return
    const xs = layout.nodes.map((node) => node.x ?? 0),
      ys = layout.nodes.map((node) => node.y ?? 0)
    const left = Math.min(...xs),
      right = Math.max(...xs),
      top = Math.min(...ys),
      bottom = Math.max(...ys)
    const scale = Math.max(
      0.15,
      Math.min(
        2,
        (size.width - 100) / Math.max(1, right - left),
        (size.height - 80) / Math.max(1, bottom - top),
      ),
    )
    setView({
      scale,
      centered: null,
      x: (-(left + right) / 2) * scale,
      y: (-(top + bottom) / 2) * scale,
    })
  }
  return (
    <div className="graph-canvas">
      {expand && (
        <IconButton
          className="graph-expand"
          aria-label="Expand graph"
          onClick={expand}
        >
          <Maximize2 size={14} />
        </IconButton>
      )}
      <svg
        ref={svg}
        role="application"
        aria-label="Workspace graph"
        tabIndex={0}
        viewBox={`${-size.width / 2} ${-size.height / 2} ${size.width} ${size.height}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          }
          const step = steps[event.key]
          if (step) {
            event.preventDefault()
            setView((old) => ({
              ...old,
              centered: null,
              x: position.x + step[0],
              y: position.y + step[1],
            }))
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          setView((old) => ({ ...old, ...position, centered: null }))
          const id =
            event.target instanceof Element
              ? event.target.closest('[data-node]')?.getAttribute('data-node')
              : null
          const node = layout.nodes.find((node) => node.id === id)
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            node,
          }
          if (node) {
            node.fx = node.x
            node.fy = node.y
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (!current || current.pointer !== event.pointerId) return
          const dx = event.clientX - current.x,
            dy = event.clientY - current.y
          if (
            Math.hypot(
              event.clientX - current.startX,
              event.clientY - current.startY,
            ) > 4
          )
            current.moved = true
          current.x = event.clientX
          current.y = event.clientY
          if (current.node) {
            current.node.fx = (current.node.fx ?? 0) + dx / view.scale
            current.node.fy = (current.node.fy ?? 0) + dy / view.scale
            current.node.x = current.node.fx
            current.node.y = current.node.fy
            if (matchMedia('(prefers-reduced-motion: reduce)').matches)
              simulation.current?.tick(30)
            else simulation.current?.alpha(0.15).restart()
            setLayout((old) => ({ ...old }))
          } else setView((old) => ({ ...old, x: old.x + dx, y: old.y + dy }))
        }}
        onPointerUp={(event) => {
          const current = drag.current
          if (!current || current.pointer !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (current.node && !current.moved) activate(current.node)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <title>Workspace note connections</title>
        <g
          transform={`translate(${position.x} ${position.y}) scale(${view.scale})`}
        >
          {layout.edges.map((edge) => (
            <line
              key={JSON.stringify([edge.source.id, edge.target.id])}
              x1={edge.source.x}
              y1={edge.source.y}
              x2={edge.target.x}
              y2={edge.target.y}
            />
          ))}
          {layout.nodes.map((node) => (
            <g
              key={node.id}
              data-node={node.id}
              data-active={node.id === active}
              transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.id}`}
              onKeyDown={(event) => {
                if (['Enter', ' '].includes(event.key)) {
                  event.preventDefault()
                  event.stopPropagation()
                  activate(node)
                }
              }}
            >
              <title>
                {node.id} · {node.degree} connections
              </title>
              <circle r={5 + Math.min(7, Math.sqrt(node.degree) * 2)} />
              <text y={-14} textAnchor="middle">
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <div className="graph-zoom">
        <IconButton
          aria-label="Zoom in"
          onClick={() =>
            setView((old) => ({ ...old, scale: Math.min(4, old.scale * 1.25) }))
          }
        >
          <Plus size={16} />
        </IconButton>
        <IconButton
          aria-label="Zoom out"
          onClick={() =>
            setView((old) => ({
              ...old,
              scale: Math.max(0.15, old.scale / 1.25),
            }))
          }
        >
          <Minus size={16} />
        </IconButton>
        <IconButton aria-label="Fit graph" onClick={fit}>
          <Focus size={16} />
        </IconButton>
      </div>
    </div>
  )
}
