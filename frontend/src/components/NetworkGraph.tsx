import { useEffect, useMemo, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { Maximize, Minus, Plus } from '../ui/Symbols'
import { IconButton } from '../ui'

import type { GraphPayload, MetricName } from '../api/types'
import { readThemeColor, useResolvedTheme } from '../lib/theme'

cytoscape.use(fcose)

/** Cytoscape paints to canvas with colour strings and will not parse the oklch
 *  theme tokens, so the graph palette lives in index.css as plain hex under
 *  --graph-* and is read out of the cascade here. Reading it inside the effect
 *  rather than at module scope is what lets the graph follow the theme.
 *
 *  Community hues are held at matched lightness so no cluster reads as more
 *  important than another purely from colour. */
function readPalette() {
  const c = (name: string, fallback: string) => readThemeColor(name, fallback)
  return {
    type: {
      PERSON: c('--graph-person', '#2D5F8A'),
      ORG: c('--graph-org', '#1F6B54'),
      LOCATION: c('--graph-location', '#9A6A1B'),
      PHONE: c('--graph-phone', '#6B3F8C'),
      BANK_ACCOUNT: c('--graph-account', '#A85423'),
      VEHICLE: c('--graph-vehicle', '#3D6B7A'),
      WEAPON: c('--graph-contraband', '#A02020'),
      DRUG: c('--graph-contraband', '#A02020'),
    } as Record<string, string>,
    community: [
      c('--graph-c1', '#2D5F8A'),
      c('--graph-c2', '#1F6B54'),
      c('--graph-c3', '#9A6A1B'),
      c('--graph-c4', '#6B3F8C'),
      c('--graph-c5', '#A83F5B'),
      c('--graph-c6', '#3D6B7A'),
      c('--graph-c7', '#A85423'),
      c('--graph-c8', '#5B7A2D'),
    ],
    signal: c('--graph-accent', '#8C2318'),
    label: c('--graph-label', '#574E44'),
    ring: c('--graph-ring', '#F4F1E9'),
    picked: c('--graph-picked', '#1A1614'),
    edge: c('--graph-edge', '#B3A793'),
    edgeTxn: c('--graph-edge-txn', '#A85423'),
    edgeCall: c('--graph-edge-call', '#6B3F8C'),
    edgeOwns: c('--graph-edge-owns', '#3D6B7A'),
    dim: Number(readThemeColor('--graph-dim', '0.14')) || 0.14,
  }
}

export interface NetworkGraphProps {
  data: GraphPayload
  sizeBy: MetricName
  colorBy: 'type' | 'community'
  /** Entity ids to emphasise: a shortest path, or the ranked key players. */
  highlighted?: Set<string>
  /** Entity ids withheld from the graph, for removal simulation. */
  removed?: Set<string>
  selectedId?: string | null
  onSelectNode?: (entityId: number) => void
  onSelectEdge?: (edgeId: string) => void
}

export default function NetworkGraph({
  data,
  sizeBy,
  colorBy,
  highlighted,
  removed,
  selectedId,
  onSelectNode,
  onSelectEdge,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  // Re-running the effect on a theme change is what repaints the canvas.
  const theme = useResolvedTheme()

  // Normalising per-view keeps the smallest node visible: raw betweenness on a
  // large graph is mostly near-zero, which would collapse every node to a dot.
  const maxScore = useMemo(() => {
    const scores = data.nodes.map((n) => n.metrics[sizeBy] ?? 0)
    return Math.max(...scores, 0.000001)
  }, [data, sizeBy])

  // Removal is deliberately not part of the element set. New elements rebuild
  // the graph and re-run the layout, which would move every node at exactly the
  // moment the investigator needs to see what fell apart. Withheld nodes are
  // hidden by class in the emphasis effect instead, so the picture holds still.
  const elements = useMemo<ElementDefinition[]>(() => {
    const ids = new Set(data.nodes.map((n) => n.id))

    return [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          entityType: n.entity_type,
          score: (n.metrics[sizeBy] ?? 0) / maxScore,
          community: n.community_id ?? 0,
        },
      })),
      ...data.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            relType: e.rel_type,
            weight: e.weight,
          },
        })),
    ]
  }, [data, sizeBy, maxScore])

  useEffect(() => {
    if (!containerRef.current) return

    const palette = readPalette()

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.15,
      maxZoom: 4,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            color: palette.label,
            'font-family': 'Inter Variable, sans-serif',
            'font-size': 11,
            'min-zoomed-font-size': 8,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-max-width': '140px',
            'text-wrap': 'ellipsis',
            // A halo in the ground colour keeps a label legible where it crosses
            // edges, which in a dense cell is most of them.
            'text-outline-color': palette.ring,
            'text-outline-width': 2.5,
            'text-outline-opacity': 0.9,
            'background-color': (el: cytoscape.NodeSingular) =>
              colorBy === 'community'
                ? palette.community[
                    el.data('community') % palette.community.length
                  ]
                : (palette.type[el.data('entityType')] ?? palette.type.PERSON),
            'border-width': 1,
            'border-color': palette.ring,
            // Area scales with the chosen centrality, which is what makes a
            // high-betweenness broker visually dominant at a glance.
            width: 'mapData(score, 0, 1, 14, 42)',
            height: 'mapData(score, 0, 1, 14, 42)',
            'transition-property': 'opacity, border-color, border-width',
            'transition-duration': matchMedia(
              '(prefers-reduced-motion: reduce)',
            ).matches
              ? 0
              : 120,
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': palette.edge,
            width: (edge: cytoscape.EdgeSingular) =>
              Math.min(
                3.2,
                0.7 + Math.sqrt(Number(edge.data('weight')) || 1) * 0.42,
              ),
            opacity: 0.65,
            'transition-property': 'opacity, line-color',
            'transition-duration': matchMedia(
              '(prefers-reduced-motion: reduce)',
            ).matches
              ? 0
              : 120,
          },
        },
        {
          selector: 'edge[relType = "TRANSACTED_WITH"]',
          style: { 'line-color': palette.edgeTxn },
        },
        {
          selector: 'edge[relType = "CALLED"]',
          style: { 'line-color': palette.edgeCall, 'line-style': 'dashed' },
        },
        {
          selector: 'edge[relType = "OWNS"]',
          style: { 'line-color': palette.edgeOwns, 'line-style': 'dotted' },
        },
        { selector: '.dimmed', style: { opacity: palette.dim } },
        {
          selector: '.flagged',
          style: {
            'border-width': 2.5,
            'border-color': palette.signal,
            opacity: 1,
          },
        },
        {
          selector: '.picked',
          style: {
            'border-width': 3.5,
            'border-color': palette.picked,
            opacity: 1,
          },
        },
        { selector: 'node.label-muted', style: { 'text-opacity': 0 } },
        {
          selector: 'node.hovered, node.picked',
          style: {
            'font-weight': 650,
            'text-opacity': 1,
            'text-outline-width': 3,
            'z-index': 20,
          },
        },
        // Removal simulation. Later rules win, so these sit last.
        { selector: '.withheld', style: { display: 'none' } },
        { selector: '.context', style: { opacity: palette.dim } },
        {
          selector: 'node.fragment',
          style: {
            'background-color': (el: cytoscape.NodeSingular) =>
              palette.community[
                Number(el.data('fragment')) % palette.community.length
              ],
          },
        },
      ],
      // Seed with a circle before refining. fcose runs incrementally when
      // randomize is off, and freshly added nodes carry no positions -- from
      // that degenerate start it settles into a straight diagonal rather than a
      // network. A circle is deterministic and gives it something to relax
      // from, so the layout still comes back identical run to run.
      layout: { name: 'circle', animate: false } as never,
    })

    cy.layout({
      name: 'fcose',
      animate: false,
      nodeRepulsion: 9000,
      idealEdgeLength: 95,
      nodeDimensionsIncludeLabels: true,
      gravity: 0.28,
      randomize: false,
    } as never).run()

    // This graph has no geographic axes. Pick the rotation that fits the
    // actual viewport, rather than the statistical long axis of the cluster.
    // Rotate only: distances, topology and the relative node positions survive.
    const nodes = cy.nodes()
    if (nodes.length > 1) {
      const points = nodes.map((node) => ({
        id: node.id(),
        ...node.position(),
      }))
      const centre = points.reduce(
        (sum, point) => ({
          x: sum.x + point.x / points.length,
          y: sum.y + point.y / points.length,
        }),
        { x: 0, y: 0 },
      )
      let best = { angle: 0, fit: 0 }
      for (let degrees = 0; degrees < 180; degrees += 5) {
        const angle = (degrees * Math.PI) / 180
        const rotated = points.map((point) => {
          const x = point.x - centre.x,
            y = point.y - centre.y
          return {
            x: x * Math.cos(angle) - y * Math.sin(angle),
            y: x * Math.sin(angle) + y * Math.cos(angle),
          }
        })
        const width =
          Math.max(...rotated.map((p) => p.x)) -
          Math.min(...rotated.map((p) => p.x)) +
          120
        const height =
          Math.max(...rotated.map((p) => p.y)) -
          Math.min(...rotated.map((p) => p.y)) +
          60
        const fit = Math.min(
          (cy.width() - 64) / width,
          (cy.height() - 64) / height,
        )
        if (fit > best.fit) best = { angle, fit }
      }
      const originals = new Map(points.map((point) => [point.id, point]))
      nodes.positions((node) => {
        const point = originals.get(node.id())!
        const x = point.x - centre.x,
          y = point.y - centre.y
        return {
          x: x * Math.cos(best.angle) - y * Math.sin(best.angle),
          y: x * Math.sin(best.angle) + y * Math.cos(best.angle),
        }
      })
    }
    cy.fit(undefined, cy.width() < 500 ? 60 : 32)
    // Label collisions are a viewport problem: keep the graph fixed and reveal
    // names as there is room. Hovered/selected nodes always take priority; every
    // entity also remains available in the inspector's keyboard-accessible list.
    let labelFrame = 0
    let labelSize = 11
    const arrangeLabels = () => {
      cancelAnimationFrame(labelFrame)
      labelFrame = requestAnimationFrame(() => {
        const bounds = containerRef.current?.getBoundingClientRect()
        if (!bounds || cy.destroyed()) return
        const nextLabelSize = 11 / Math.min(cy.zoom(), 1)
        if (Math.abs(nextLabelSize - labelSize) > 0.01) {
          labelSize = nextLabelSize
          cy.nodes().style({
            'font-size': labelSize,
            'text-max-width': 140 / Math.min(cy.zoom(), 1),
          })
        }
        type Box = { x1: number; y1: number; x2: number; y2: number }
        const occupied: Box[] = []
        const overlays = containerRef.current?.parentElement?.querySelectorAll(
          '.graph-controls, [data-graph-overlay]',
        )
        overlays?.forEach((overlay) => {
          const controls = overlay.getBoundingClientRect()
          occupied.push({
            x1: controls.left - bounds.left,
            x2: controls.right - bounds.left,
            y1: controls.top - bounds.top,
            y2: controls.bottom - bounds.top,
          })
        })
        const priority = (node: cytoscape.NodeSingular) =>
          Number(node.hasClass('hovered')) * 4 +
          Number(node.hasClass('picked')) * 2 +
          Number(node.data('score'))
        const ordered = [...cy.nodes(':visible')].sort(
          (a, b) => priority(b) - priority(a),
        )
        cy.batch(() => {
          for (const node of ordered) {
            const box = node.renderedBoundingBox({
              includeNodes: false,
              includeEdges: false,
              includeOverlays: false,
            })
            const collides = occupied.some(
              (other) =>
                box.x1 < other.x2 + 3 &&
                box.x2 > other.x1 - 3 &&
                box.y1 < other.y2 + 3 &&
                box.y2 > other.y1 - 3,
            )
            const hidden =
              collides && !node.hasClass('hovered') && !node.hasClass('picked')
            node.toggleClass('label-muted', hidden)
            if (!hidden) occupied.push(box)
          }
        })
      })
    }
    cy.on('zoom pan position labelpriority', arrangeLabels)
    cy.on('mouseover', 'node', (event) => {
      event.target.addClass('hovered')
      arrangeLabels()
    })
    cy.on('mouseout', 'node', (event) => {
      event.target.removeClass('hovered')
      arrangeLabels()
    })
    arrangeLabels()

    if (onSelectNode)
      cy.on('tap', 'node', (e) => onSelectNode(Number(e.target.id())))
    if (onSelectEdge)
      cy.on('tap', 'edge', (e) => onSelectEdge(String(e.target.id())))
    // Tapping empty canvas clears the selection.
    if (onSelectNode)
      cy.on('tap', (e) => {
        if (e.target === cy) onSelectNode(-1)
      })

    cyRef.current = cy
    const resize = new ResizeObserver(() => {
      cy.resize()
      arrangeLabels()
    })
    resize.observe(containerRef.current)
    return () => {
      resize.disconnect()
      cancelAnimationFrame(labelFrame)
      cy.destroy()
      cyRef.current = null
    }
  }, [elements, colorBy, theme, onSelectNode, onSelectEdge])

  // Emphasis is applied without touching the layout: re-running it on every
  // selection would scramble the mental map the investigator just built.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    const gone = removed ?? new Set<string>()

    cy.batch(() => {
      cy.elements().removeClass(
        'dimmed flagged picked withheld context fragment',
      )

      if (gone.size) {
        const withheld = cy.nodes().filter((node) => gone.has(node.id()))
        withheld.addClass('withheld')

        // Show the network the removal analysis actually scores: people only.
        // Places the extractor typed as organisations would otherwise bridge
        // the cells on screen and hide the split the numbers describe.
        const people = cy.nodes('[entityType = "PERSON"]').not(withheld)
        const context = cy.nodes().not(people).not(withheld)
        context.union(context.connectedEdges()).addClass('context')

        people
          .union(people.edgesWith(people))
          .components()
          .sort((a, b) => b.nodes().length - a.nodes().length)
          .forEach((component, index) => {
            component.nodes().data('fragment', index).addClass('fragment')
          })
      }

      if (highlighted?.size) {
        cy.nodes().forEach((node) => {
          if (highlighted.has(node.id())) node.addClass('flagged')
          else node.addClass('dimmed')
        })
        cy.edges().forEach((edge) => {
          const both =
            highlighted.has(edge.source().id()) &&
            highlighted.has(edge.target().id())
          if (!both) edge.addClass('dimmed')
        })
      }

      if (selectedId) {
        const node = cy.getElementById(selectedId)
        if (node.nonempty()) {
          if (!highlighted?.size && !gone.size) cy.elements().addClass('dimmed')
          node.removeClass('dimmed').addClass('picked')
          node.neighborhood().removeClass('dimmed')
        }
      }
    })
    cy.emit('labelpriority')
  }, [highlighted, selectedId, elements, removed, theme, colorBy])

  const zoom = (factor: number) => {
    const cy = cyRef.current
    if (cy)
      cy.zoom({
        level: Math.min(
          cy.maxZoom(),
          Math.max(cy.minZoom(), cy.zoom() * factor),
        ),
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      })
  }
  return (
    <>
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label={`Network with ${data.nodes.length} entities and ${data.edges.length} connections. Select an entity from the key players list to inspect it.`}
      />
      <div className="graph-controls" aria-label="Graph zoom controls">
        <IconButton label="Zoom in" onClick={() => zoom(1.25)}>
          <Plus size={18} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoom(0.8)}>
          <Minus size={18} />
        </IconButton>
        <IconButton
          label="Fit network to view"
          onClick={() => {
            const cy = cyRef.current
            cy?.fit(undefined, cy.width() < 500 ? 60 : 32)
          }}
        >
          <Maximize size={17} />
        </IconButton>
      </div>
    </>
  )
}
