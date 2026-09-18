import { createContext, useContext } from 'react'

import type { Artifact, CandidateOut, Evidence, Family, Person } from '../../api/investigation'

/** The lookup tables one finding's response refers into, plus the workspace's
 *  originals by filename (for integrity state). Provided once per finding so
 *  an evidence row anywhere in the tree can resolve a key without every
 *  component in between carrying the tables. */
export interface FindingTablesValue {
  people: Record<string, Person>
  evidence: Record<string, Evidence>
  families: Record<string, Family>
  candidates: Record<string, CandidateOut>
  artifacts: Map<string, Artifact> | null
}

const EMPTY: FindingTablesValue = {
  people: {},
  evidence: {},
  families: {},
  candidates: {},
  artifacts: null,
}

export const FindingTablesContext = createContext<FindingTablesValue>(EMPTY)

export function useFindingTables(): FindingTablesValue {
  return useContext(FindingTablesContext)
}
