import { useEffect, useMemo, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'

import type { GraphPayload, MetricName } from '../api/types'

cytoscape.use(fcose)

/** Community palette: distinct hues held at matched lightness, so no cluster
 *  reads as more important than another purely from colour. */
const COMMUNITY_COLORS = [
  '#7c9cf5', '#5cc8a6', '#e0b25f', '#b98ef0',
  '#ef7d8e', '#54c2d6', '#f0995e', '#93c96a',
]

const TYPE_COLORS: Record<string, string> = {
  PERSON: '#7c9cf5',
  ORG: '#5cc8a6',
  LOCATION: '#e0b25f',
  PHONE: '#b98ef0',
  BANK_ACCOUNT: '#f0995e',
  VEHICLE: '#54c2d6',
  WEAPON: '#e2635f',
  DRUG: '#e2635f',
}

const SIGNAL = '#f0a83c'

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
            color: '#a9b2c4',
            'font-family': 'IBM Plex Sans, sans-serif',
            'font-size': 9,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-max-width': '110px',
            'text-wrap': 'ellipsis',
            'background-color': (el: cytoscape.NodeSingular) =>
              colorBy === 'community'
                ? COMMUNITY_COLORS[el.data('community') % COMMUNITY_COLORS.length]
                : (TYPE_COLORS[el.data('entityType')] ?? '#7c9cf5'),
            'border-width': 1,
            'border-color': '#12151f',
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
            'line-color': '#2f3646',
            width: 'mapData(weight, 0, 12, 0.7, 4.5)',
            opacity: 0.75,
            'transition-property': 'opacity, line-color',
            'transition-duration': 180,
          },
        },
        { selector: 'edge[relType = "TRANSACTED_WITH"]', style: { 'line-color': '#8a5c33' } },
        { selector: 'edge[relType = "CALLED"]', style: { 'line-color': '#6a5285', 'line-style': 'dashed' } },
        { selector: 'edge[relType = "OWNS"]', style: { 'line-color': '#2a3a46', 'line-style': 'dotted' } },
        { selector: '.dimmed', style: { opacity: 0.08 } },
        {
          selector: '.flagged',
          style: { 'border-width': 2.5, 'border-color': SIGNAL, opacity: 1 },
        },
        {
          selector: '.picked',
          style: { 'border-width': 3.5, 'border-color': '#ffffff', opacity: 1 },
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
  }, [elements, colorBy, onSelectNode, onSelectEdge])

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

export { TYPE_COLORS, COMMUNITY_COLORS }
