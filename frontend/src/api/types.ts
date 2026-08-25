/** Mirrors backend/app/schemas.py. Keep the two in sync. */

export type EntityType =
  | 'PERSON' | 'ORG' | 'LOCATION' | 'PHONE'
  | 'BANK_ACCOUNT' | 'VEHICLE' | 'WEAPON' | 'DRUG'

export type RelType =
  | 'ASSOCIATES_WITH' | 'TRANSACTED_WITH' | 'CALLED'
  | 'LOCATED_AT' | 'MEMBER_OF' | 'OWNS'

export type AlertType =
  | 'TRANSACTION_SPIKE' | 'STRUCTURING' | 'COMM_BURST'
  | 'NEW_LINK' | 'HIGH_CENTRALITY_SHIFT'

export type Severity = 'low' | 'medium' | 'high'
export type DocStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface Case {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface CaseStats {
  case_id: number
  documents: number
  entities: number
  relationships: number
  transactions: number
  comm_events: number
  open_alerts: number
}

export interface Mention {
  id: number
  entity_id: number
  span_start: number
  span_end: number
  surface_text: string
}

export interface Doc {
  id: number
  case_id: number
  filename: string
  doc_type: string
  status: DocStatus
  error: string | null
  uploaded_at: string
}

export interface DocDetail extends Doc {
  raw_text: string | null
  mentions: Mention[]
}

export interface Entity {
  id: number
  case_id: number
  canonical_name: string
  entity_type: EntityType
  aliases: string[]
  meta: Record<string, unknown>
}

export interface EntityProfile extends Entity {
  metrics: Record<string, number>
  community_id: number | null
  mention_count: number
  related_alert_ids: number[]
}

export interface GraphNode {
  id: string
  label: string
  entity_type: EntityType
  metrics: Record<string, number>
  community_id: number | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  rel_type: RelType
  weight: number
  evidence: { doc_id: number; snippet: string }[]
}

export interface GraphPayload {
  case_id: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  total_nodes: number
}

export interface KeyPlayer {
  entity_id: number
  name: string
  entity_type: EntityType
  metric: string
  score: number
  rank: number
}

export interface Community {
  community_id: number
  size: number
  member_entity_ids: number[]
  dominant_entity_type: EntityType
  top_member: string
}

export interface PathResult {
  found: boolean
  entity_ids: number[]
  names: string[]
  edges: GraphEdge[]
  hops: number
}

export interface RemovalImpact {
  entity_id: number
  name: string
  components_before: number
  components_after: number
  largest_component_before: number
  largest_component_after: number
  fragmentation_delta: number
}

export interface VulnerabilityReport {
  articulation_point_entity_ids: number[]
  removal_impacts: RemovalImpact[]
}

export interface Alert {
  id: number
  case_id: number
  alert_type: AlertType
  severity: Severity
  title: string
  description: string | null
  entity_ids: number[]
  evidence: Record<string, unknown>
  status: 'open' | 'reviewed'
  created_at: string
}

export type MetricName = 'degree' | 'betweenness' | 'eigenvector' | 'pagerank'
