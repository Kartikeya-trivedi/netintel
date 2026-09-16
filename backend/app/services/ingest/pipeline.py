"""Ingest orchestration: parse -> extract -> resolve -> persist -> link.

Runs in a FastAPI BackgroundTask started by routers.ingest.upload_document.
Owns its own DB session, because the request session is already closed by the
time this executes.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.db import SessionLocal
from app.services.extraction import resolver
from app.services.extraction.ner import alias_links, extract_entities
from app.services.extraction.relations import extract_relations
from app.services.ingest.csv_ingest import parse_csv
from app.services.ingest.report_parser import parse_to_text

logger = logging.getLogger(__name__)

# Maximum evidence snippets stored per relationship. Enough to justify an edge
# in the UI without letting one heavily-reported pair bloat the row.
MAX_EVIDENCE_PER_RELATIONSHIP = 8


def process_document(document_id: int, raw: bytes, *, detect: bool = True) -> None:
    """Process one uploaded document end to end.

    Failures are recorded on the Document row rather than raised, so one bad
    file never blocks the rest of a bulk upload.

    detect=False skips anomaly detection, for callers loading many files as a
    single event that run detection once themselves when the load is complete.
    """
    db = SessionLocal()
    try:
        doc = db.get(models.Document, document_id)
        if doc is None:
            logger.error("Document %s vanished before processing", document_id)
            return

        doc.status = "processing"
        db.commit()

        if doc.doc_type == "report":
            _ingest_report(db, doc, raw)
        else:
            _ingest_records(db, doc, raw)

        link_records_to_entities(db, doc.case_id)

        doc.status = "processed"
        doc.error = None
        db.commit()

        # Centrality feeds one of the detectors, so the stale cache has to go
        # before detection runs, not after.
        _invalidate_graph_cache(doc.case_id)
        if detect:
            _run_detection(doc.case_id, db)

    except Exception as exc:
        db.rollback()
        doc = db.get(models.Document, document_id)
        if doc is not None:
            doc.status = "failed"
            doc.error = f"{type(exc).__name__}: {exc}"
            db.commit()
        logger.exception("Ingest failed for document %s", document_id)
    finally:
        db.close()


def _invalidate_graph_cache(case_id: int) -> None:
    """Drop cached centrality for the case; imported lazily to avoid a cycle."""
    from app.services.graph import analytics

    analytics.invalidate_cache(case_id)


def _run_detection(case_id: int, db: Session) -> None:
    """Raise anomaly alerts for the case.

    The document is already marked processed by this point, so a detector
    failure must not flip it back to failed: the file really did ingest. The
    error is logged and the ingest still counts.
    """
    from app.services.anomaly.detector import run_detection

    try:
        run_detection(db, case_id)
    except Exception:
        db.rollback()
        logger.exception("Anomaly detection failed for case %s", case_id)


# --- Reports -----------------------------------------------------------------


def _ingest_report(db: Session, doc: models.Document, raw: bytes) -> None:
    """Extract entities and relationships from a narrative report."""
    text = parse_to_text(doc.filename, raw)
    doc.raw_text = text
    db.flush()

    entities = extract_entities(text, gazetteer=_case_gazetteer(db, doc.case_id))
    if not entities:
        logger.info("No entities extracted from document %s", doc.id)
        return

    candidates = [
        {"text": e.text, "entity_type": e.entity_type, "start": e.start, "end": e.end}
        for e in entities
    ]
    clusters = resolver.resolve(candidates)
    # An explicit "X alias Y" in the report beats string similarity.
    clusters = resolver.apply_alias_links(clusters, alias_links(text))

    # span -> entity id, so relations can be mapped onto persisted rows.
    span_to_entity: dict[tuple[int, int], int] = {}

    for cluster in clusters:
        entity = _upsert_entity(db, doc.case_id, cluster, first_seen_doc_id=doc.id)
        for member in cluster["members"]:
            span_to_entity[(member["start"], member["end"])] = entity.id
            db.add(
                models.Mention(
                    entity_id=entity.id,
                    document_id=doc.id,
                    span_start=member["start"],
                    span_end=member["end"],
                    surface_text=member["text"],
                )
            )
    db.flush()

    for relation in extract_relations(text, entities, doc_id=doc.id):
        source_id = span_to_entity.get((relation.source.start, relation.source.end))
        target_id = span_to_entity.get((relation.target.start, relation.target.end))
        # A mention and its own alias resolve to one entity; that is a successful
        # merge, not an edge, so the self-loop is dropped.
        if source_id is None or target_id is None or source_id == target_id:
            continue
        _upsert_relationship(
            db,
            doc.case_id,
            source_id,
            target_id,
            relation.rel_type,
            weight=relation.weight,
            evidence=relation.evidence,
        )
    db.flush()


def _case_gazetteer(db: Session, case_id: int) -> dict[str, str]:
    """Known surface forms for this case, mapped to their entity type.

    Only names and organisations. Identifiers already have exact patterns, and
    feeding them back in would add nothing.
    """
    stored = db.scalars(
        select(models.Entity).where(
            models.Entity.case_id == case_id,
            models.Entity.entity_type.in_(["PERSON", "ORG"]),
        )
    ).all()

    gazetteer: dict[str, str] = {}
    for entity in stored:
        for surface in [entity.canonical_name, *(entity.aliases or [])]:
            if surface and len(surface) >= 3:
                gazetteer[surface] = entity.entity_type
    return gazetteer


def _upsert_entity(
    db: Session, case_id: int, cluster: dict, *, first_seen_doc_id: int | None = None
) -> models.Entity:
    """Find the existing entity this cluster refers to, or create it.

    Resolution has to reach across documents, not just within one. Otherwise the
    same person named in ten reports becomes ten nodes and the graph is a lie.
    """
    entity_type = cluster["entity_type"]
    canonical = cluster["canonical_name"]
    surfaces = [canonical, *cluster["aliases"]]

    existing = _find_existing_entity(db, case_id, entity_type, surfaces)

    if existing is None:
        existing = models.Entity(
            case_id=case_id,
            canonical_name=canonical,
            entity_type=entity_type,
            aliases=cluster["aliases"],
            meta={},
            first_seen_doc_id=first_seen_doc_id,
        )
        db.add(existing)
        db.flush()
        return existing

    merged = {*(existing.aliases or []), *cluster["aliases"], canonical}
    merged.discard(existing.canonical_name)
    existing.aliases = sorted(merged)
    return existing


def _find_existing_entity(
    db: Session, case_id: int, entity_type: str, surfaces: list[str]
) -> models.Entity | None:
    """Match against entities already stored for the case."""
    stored = db.scalars(
        select(models.Entity).where(
            models.Entity.case_id == case_id,
            models.Entity.entity_type == entity_type,
        )
    ).all()
    if not stored:
        return None

    exact = entity_type in resolver.EXACT_MATCH_TYPES
    normalize = resolver.normalize_identifier if exact else resolver.normalize_name
    wanted = {normalize(s) for s in surfaces if s}

    for entity in stored:
        known = {normalize(s) for s in [entity.canonical_name, *(entity.aliases or [])] if s}
        if wanted & known:
            return entity
        if exact:
            continue
        if any(resolver.names_match(w, k) for w in wanted for k in known):
            return entity
    return None


def _upsert_relationship(
    db: Session,
    case_id: int,
    source_id: int,
    target_id: int,
    rel_type: str,
    *,
    weight: float,
    evidence: list[dict],
) -> models.Relationship:
    """Accumulate weight and evidence onto an existing edge, or create it."""
    existing = db.scalar(
        select(models.Relationship).where(
            models.Relationship.case_id == case_id,
            models.Relationship.source_entity_id == source_id,
            models.Relationship.target_entity_id == target_id,
            models.Relationship.rel_type == rel_type,
        )
    )

    if existing is None:
        existing = models.Relationship(
            case_id=case_id,
            source_entity_id=source_id,
            target_entity_id=target_id,
            rel_type=rel_type,
            weight=weight,
            evidence=evidence[:MAX_EVIDENCE_PER_RELATIONSHIP],
        )
        db.add(existing)
        db.flush()
        return existing

    existing.weight = (existing.weight or 0.0) + weight
    combined = [*(existing.evidence or []), *evidence]
    existing.evidence = combined[:MAX_EVIDENCE_PER_RELATIONSHIP]
    return existing


# --- Structured records ------------------------------------------------------


def _ingest_records(db: Session, doc: models.Document, raw: bytes) -> None:
    """Persist transactions, call records, or subscriber mappings."""
    rows = parse_csv(raw, doc.doc_type)
    doc.raw_text = None

    handlers = {
        "transactions": _persist_transactions,
        "call_records": _persist_comm_events,
        "subscriber_records": _persist_subscribers,
    }
    handlers[doc.doc_type](db, doc, rows)
    db.flush()


def _persist_transactions(db: Session, doc: models.Document, rows: list[dict]) -> None:
    for row in rows:
        db.add(
            models.Transaction(
                case_id=doc.case_id,
                document_id=doc.id,
                txn_ref=row.get("txn_ref"),
                from_account=row["from_account"],
                to_account=row["to_account"],
                amount=row["amount"],
                timestamp=row["timestamp"],
            )
        )


def _persist_comm_events(db: Session, doc: models.Document, rows: list[dict]) -> None:
    for row in rows:
        duration = row.get("duration_sec")
        db.add(
            models.CommEvent(
                case_id=doc.case_id,
                document_id=doc.id,
                caller=row["caller"],
                callee=row["callee"],
                timestamp=row["timestamp"],
                duration_sec=int(float(duration)) if duration is not None else None,
            )
        )


def _persist_subscribers(db: Session, doc: models.Document, rows: list[dict]) -> None:
    """Turn KYC/subscriber rows into owner entities and OWNS edges.

    This is what lets a bare account number in a bank statement join up with a
    name in a police report -- the cross-source link manual review misses.
    """
    for row in rows:
        identifier = row["identifier"]
        owner_name = row["owner_name"]
        declared = (row.get("identifier_type") or "").strip().casefold()
        entity_type = {"phone": "PHONE", "account": "BANK_ACCOUNT"}.get(
            declared, _infer_identifier_type(identifier)
        )

        owner = _upsert_entity(
            db,
            doc.case_id,
            {"canonical_name": owner_name, "entity_type": "PERSON", "aliases": [], "members": []},
            first_seen_doc_id=doc.id,
        )
        identity = _upsert_entity(
            db,
            doc.case_id,
            {
                "canonical_name": identifier,
                "entity_type": entity_type,
                "aliases": [],
                "members": [],
            },
            first_seen_doc_id=doc.id,
        )
        db.flush()

        _upsert_relationship(
            db,
            doc.case_id,
            owner.id,
            identity.id,
            "OWNS",
            weight=1.0,
            evidence=[
                {"doc_id": doc.id, "snippet": f"Subscriber record: {identifier} -> {owner_name}"}
            ],
        )


def _infer_identifier_type(identifier: str) -> str:
    digits = resolver.normalize_identifier(identifier)
    return "PHONE" if len(digits) == 10 and digits.isdigit() else "BANK_ACCOUNT"


def link_records_to_entities(db: Session, case_id: int) -> int:
    """Attach transactions and call records to the people behind the identifiers.

    Runs after every ingest so upload order does not matter: a transactions file
    loaded before its subscriber list gets linked as soon as the list lands.
    """
    owner_by_identifier = _owner_index(db, case_id)
    if not owner_by_identifier:
        return 0

    linked = 0

    unlinked_txns = db.scalars(
        select(models.Transaction).where(
            models.Transaction.case_id == case_id,
            (models.Transaction.from_entity_id.is_(None))
            | (models.Transaction.to_entity_id.is_(None)),
        )
    ).all()
    for txn in unlinked_txns:
        from_id = owner_by_identifier.get(resolver.normalize_identifier(txn.from_account))
        to_id = owner_by_identifier.get(resolver.normalize_identifier(txn.to_account))
        if txn.from_entity_id is None and from_id is not None:
            txn.from_entity_id = from_id
            linked += 1
        if txn.to_entity_id is None and to_id is not None:
            txn.to_entity_id = to_id
            linked += 1

    unlinked_calls = db.scalars(
        select(models.CommEvent).where(
            models.CommEvent.case_id == case_id,
            (models.CommEvent.caller_entity_id.is_(None))
            | (models.CommEvent.callee_entity_id.is_(None)),
        )
    ).all()
    for call in unlinked_calls:
        caller_id = owner_by_identifier.get(resolver.normalize_identifier(call.caller))
        callee_id = owner_by_identifier.get(resolver.normalize_identifier(call.callee))
        if call.caller_entity_id is None and caller_id is not None:
            call.caller_entity_id = caller_id
            linked += 1
        if call.callee_entity_id is None and callee_id is not None:
            call.callee_entity_id = callee_id
            linked += 1

    db.commit()
    return linked


def _owner_index(db: Session, case_id: int) -> dict[str, int]:
    """Normalised identifier -> owning PERSON entity id, derived from OWNS edges."""
    owns = db.scalars(
        select(models.Relationship).where(
            models.Relationship.case_id == case_id,
            models.Relationship.rel_type == "OWNS",
        )
    ).all()
    if not owns:
        return {}

    identifier_ids = {r.target_entity_id for r in owns}
    identifiers = db.scalars(
        select(models.Entity).where(models.Entity.id.in_(identifier_ids))
    ).all()
    by_id: dict[int, models.Entity] = {e.id: e for e in identifiers}

    index: dict[str, int] = {}
    for rel in owns:
        identity = by_id.get(rel.target_entity_id)
        if identity is None or identity.entity_type not in {"PHONE", "BANK_ACCOUNT"}:
            continue
        for surface in [identity.canonical_name, *(identity.aliases or [])]:
            index[resolver.normalize_identifier(surface)] = rel.source_entity_id
    return index
