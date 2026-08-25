import type { EntityType } from '../api/types'

/** Entity-type colours are the primary encoding across graph, documents, and
 *  alerts, so they are defined once here rather than re-picked per view. */
const TYPE_STYLES: Record<EntityType, { label: string; className: string }> = {
  PERSON: { label: 'Person', className: 'text-ent-person border-ent-person/40' },
  ORG: { label: 'Org', className: 'text-ent-org border-ent-org/40' },
  LOCATION: { label: 'Location', className: 'text-ent-location border-ent-location/40' },
  PHONE: { label: 'Phone', className: 'text-ent-phone border-ent-phone/40' },
  BANK_ACCOUNT: { label: 'Account', className: 'text-ent-account border-ent-account/40' },
  VEHICLE: { label: 'Vehicle', className: 'text-ent-vehicle border-ent-vehicle/40' },
  WEAPON: { label: 'Weapon', className: 'text-ent-contraband border-ent-contraband/40' },
  DRUG: { label: 'Narcotic', className: 'text-ent-contraband border-ent-contraband/40' },
}

export default function EntityBadge({ type }: { type: EntityType }) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.PERSON
  return (
    <span
      className={`shrink-0 border px-1.5 py-0.5 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] ${style.className}`}
    >
      {style.label}
    </span>
  )
}

export { TYPE_STYLES }
