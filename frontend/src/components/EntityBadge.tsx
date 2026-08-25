import type { EntityType } from '../api/types'

/** Entity-type colours are the primary encoding across graph, documents, and
 *  alerts, so they are defined once here rather than re-picked per view. */
const TYPE_STYLES: Record<EntityType, { label: string; className: string }> = {
  PERSON: { label: 'Person', className: 'bg-entity-person/15 text-entity-person' },
  ORG: { label: 'Organisation', className: 'bg-entity-org/15 text-entity-org' },
  LOCATION: { label: 'Location', className: 'bg-entity-location/15 text-entity-location' },
  PHONE: { label: 'Phone', className: 'bg-entity-phone/15 text-entity-phone' },
  BANK_ACCOUNT: { label: 'Account', className: 'bg-entity-account/15 text-entity-account' },
  VEHICLE: { label: 'Vehicle', className: 'bg-entity-vehicle/15 text-entity-vehicle' },
  WEAPON: { label: 'Weapon', className: 'bg-entity-contraband/15 text-entity-contraband' },
  DRUG: { label: 'Narcotic', className: 'bg-entity-contraband/15 text-entity-contraband' },
}

export default function EntityBadge({ type }: { type: EntityType }) {
  const style = TYPE_STYLES[type]
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.className}`}>
      {style.label}
    </span>
  )
}

export { TYPE_STYLES }
