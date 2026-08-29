import { useEffect, useMemo, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'

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
      c('--graph-c1', '#2D5F8A'), c('--graph-c2', '#1F6B54'),
      c('--graph-c3', '#9A6A1B'), c('--graph-c4', '#6B3F8C'),
      c('--graph-c5', '#A83F5B'), c('--graph-c6', '#3D6B7A'),
      c('--graph-c7', '#A85423'), c('--graph-c8', '#5B7A2D'),
    ],
    signal: c('--graph-signal', '#8C2318'),
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

  const elements = useMemo<ElementDefinition[]>(() => {
    const gone = removed ?? new Set<string>()
    const visible = data.nodes.filter((n) => !gone.has(n.id))
    const ids = new Set(visible.map((n) => n.id))

    return [
      ...visible.map((n) => ({
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
  }, [data, sizeBy, maxScore, removed])

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
            'font-family': 'IBM Plex Sans, sans-serif',
            'font-size': 9,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-max-width': '110px',
            'text-wrap': 'ellipsis',
            'background-color': (el: cytoscape.NodeSingular) =>
              colorBy === 'community'
                ? palette.community[el.data('community') % palette.community.length]
                : (palette.type[el.data('entityType')] ?? palette.type.PERSON),
            'border-width': 1,
            'border-color': palette.ring,
            // Area scales with the chosen centrality, which is what makes a
            // high-betweenness broker visually dominant at a glance.
            width: 'mapData(score, 0, 1, 11, 54)',
            height: 'mapData(score, 0, 1, 11, 54)',
            'transition-property': 'opacity, border-color, border-width',
            'transition-duration': 180,
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': palette.edge,
            width: 'mapData(weight, 0, 12, 0.7, 4.5)',
            opacity: 0.8,
            'transition-property': 'opacity, line-color',
            'transition-duration': 180,
          },
        },
        { selector: 'edge[relType = "TRANSACTED_WITH"]', style: { 'line-color': palette.edgeTxn } },
        { selector: 'edge[relType = "CALLED"]', style: { 'line-color': palette.edgeCall, 'line-style': 'dashed' } },
        { selector: 'edge[relType = "OWNS"]', style: { 'line-color': palette.edgeOwns, 'line-style': 'dotted' } },
        { selector: '.dimmed', style: { opacity: palette.dim } },
        {
          selector: '.flagged',
          style: { 'border-width': 2.5, 'border-color': palette.signal, opacity: 1 },
        },
        {
          selector: '.picked',
          style: { 'border-width': 3.5, 'border-color': palette.picked, opacity: 1 },
        },
      ],
      layout: {
        name: 'fcose',
        animate: false,
        nodeRepulsion: 9000,
        idealEdgeLength: 95,
        gravity: 0.28,
        randomize: false,
      } as never,
    })

    if (onSelectNode) cy.on('tap', 'node', (e) => onSelectNode(Number(e.target.id())))
    if (onSelectEdge) cy.on('tap', 'edge', (e) => onSelectEdge(String(e.target.id())))
    // Tapping empty canvas clears the selection.
    if (onSelectNode) cy.on('tap', (e) => { if (e.target === cy) onSelectNode(-1) })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [elements, colorBy, theme, onSelectNode, onSelectEdge])

  // Emphasis is applied without touching the layout: re-running it on every
  // selection would scramble the mental map the investigator just built.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.batch(() => {
      cy.elements().removeClass('dimmed flagged picked')

      if (highlighted?.size) {
        cy.nodes().forEach((node) => {
          if (highlighted.has(node.id())) node.addClass('flagged')
          else node.addClass('dimmed')
        })
        cy.edges().forEach((edge) => {
          const both =
            highlighted.has(edge.source().id()) && highlighted.has(edge.target().id())
          if (!both) edge.addClass('dimmed')
        })
      }

      if (selectedId) {
        const node = cy.getElementById(selectedId)
        if (node.nonempty()) {
          node.removeClass('dimmed').addClass('picked')
          node.neighborhood().removeClass('dimmed')
        }
      }
    })
  }, [highlighted, selectedId, elements])

  return <div ref={containerRef} className="h-full w-full" />
}

