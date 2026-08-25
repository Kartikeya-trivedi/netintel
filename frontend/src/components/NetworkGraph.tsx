import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import fcose from 'cytoscape-fcose'

import type { GraphPayload, MetricName } from '../api/types'

cytoscape.use(fcose)

/** Community palette. Distinct hues at matched lightness, so no single cluster
 *  reads as more important than another purely from colour. */
const COMMUNITY_COLORS = [
  '#7aa2f7', '#7bd88f', '#e0af68', '#bb9af7',
  '#f7768e', '#2ac3de', '#ff9e64', '#9ece6a',
]

const TYPE_COLORS: Record<string, string> = {
  PERSON: '#7aa2f7',
  ORG: '#7bd88f',
  LOCATION: '#e0af68',
  PHONE: '#bb9af7',
  BANK_ACCOUNT: '#ff9e64',
  VEHICLE: '#2ac3de',
  WEAPON: '#f7768e',
  DRUG: '#f7768e',
}

export interface NetworkGraphProps {
  data: GraphPayload
  /** Which centrality drives node size. */
  sizeBy: MetricName
  /** Colour nodes by detected community instead of entity type. */
  colorBy: 'type' | 'community'
  /** Entity ids to emphasise, e.g. a shortest path or the top-N key players. */
  highlighted?: Set<string>
  onSelectNode?: (entityId: number) => void
  onSelectEdge?: (edgeId: string) => void
}

export default function NetworkGraph({
  data,
  sizeBy,
  colorBy,
  highlighted,
  onSelectNode,
  onSelectEdge,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const elements: ElementDefinition[] = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          entityType: n.entity_type,
          score: n.metrics[sizeBy] ?? 0,
          community: n.community_id ?? 0,
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          relType: e.rel_type,
          weight: e.weight,
        },
      })),
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            color: '#c8d0e0',
            'font-size': 9,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'background-color': (el: cytoscape.NodeSingular) =>
              colorBy === 'community'
                ? COMMUNITY_COLORS[el.data('community') % COMMUNITY_COLORS.length]
                : (TYPE_COLORS[el.data('entityType')] ?? '#7aa2f7'),
            // mapData scales node area to the selected centrality, which is what
            // makes a high-betweenness broker visually dominant.
            width: 'mapData(score, 0, 1, 14, 60)',
            height: 'mapData(score, 0, 1, 14, 60)',
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': '#3b4261',
            width: 'mapData(weight, 0, 10, 1, 6)',
            opacity: 0.7,
          },
        },
        {
          selector: 'edge[relType = "TRANSACTED_WITH"]',
          style: { 'line-color': '#ff9e64', 'line-style': 'solid' },
        },
        {
          selector: 'edge[relType = "CALLED"]',
          style: { 'line-color': '#bb9af7', 'line-style': 'dashed' },
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.12 },
        },
        {
          selector: '.highlighted',
          style: { 'border-width': 3, 'border-color': '#ffffff', opacity: 1 },
        },
      ],
      layout: { name: 'fcose', animate: false, nodeRepulsion: 8000, idealEdgeLength: 90 } as never,
    })

    if (onSelectNode) {
      cy.on('tap', 'node', (event) => onSelectNode(Number(event.target.id())))
    }
    if (onSelectEdge) {
      cy.on('tap', 'edge', (event) => onSelectEdge(String(event.target.id())))
    }

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [data, sizeBy, colorBy, onSelectNode, onSelectEdge])

  // Highlighting is applied separately so changing the selection never forces a
  // relayout, which would scramble the mental map the investigator just built.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('dimmed highlighted')
      if (highlighted?.size) {
        cy.nodes().forEach((node) => {
          if (highlighted.has(node.id())) node.addClass('highlighted')
          else node.addClass('dimmed')
        })
      }
    })
  }, [highlighted])

  return <div ref={containerRef} className="h-full w-full" />
}
