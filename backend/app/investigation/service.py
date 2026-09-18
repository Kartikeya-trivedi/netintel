"""Database <-> engine glue for the investigation layer.

Consumed by the investigation router, routers.ingest, the Broken Mirror loader
and the tests.

The order of operations is the point of this module. Originals are preserved
before anything parses them. Permissions are resolved before anything is
loaded, so the engine only ever sees cases the caller may compare. Every
decision bumps a version and snapshots what the findings looked like, so an
earlier interpretation is never overwritten, only superseded.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import models as core
from app.investigation import access, audit, lineage, sensitivity, verification
from app.investigation import engine as E
from app.investigation.extract import EXTRACTOR_VERSION, ExtractionError, extract
from app.investigation.models import (
    AssertionReview,
    AssertionRow,
    CaseProfile,
    EvidenceArtifact,
    EvidenceItem,
    FindingSnapshot,
    GroupingDecision,
    IdentityDecisionRow,
    Principal,
    ScenarioRun,
    Workspace,
)
from app.investigation.normalize import case_of, identifier_type, identifier_value, is_person
from app.investigation.store import IntegrityError, MissingOriginal, digest, get_store

logger = logging.getLogger(__name__)

REVIEW_STATES = frozenset({"accepted", "disputed", "rejected"})
IDENTITY_DECISIONS = frozenset({"accepted", "rejected", "deferred"})
GROUPING_DECISIONS = frozenset({"accepted", "rejected"})
MAX_DERIVATIONS_SHOWN = 6

# Display only. Every stored and computed time is UTC.
IST = timezone(timedelta(hours=5, minutes=30))


class VersionConflict(Exception):
    """The workspace moved on since the caller last looked."""


class NotFound(Exception):
    """Nothing by that key in this workspace."""


class InvalidRequest(ValueError):
    """The request is well-formed but asks for something that cannot be done."""


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


# --- Cases and originals ---------------------------------------------------------


def case_code(db: Session, case_id: int) -> str:
    profile = db.scalar(select(CaseProfile).where(CaseProfile.case_id == case_id))
    return profile.code if profile else f"CASE-{case_id}"


def ensure_profile(db: Session, case_id: int, code: str, agency: str | None = None) -> CaseProfile:
    profile = db.scalar(select(CaseProfile).where(CaseProfile.case_id == case_id))
    if profile is None:
        profile = CaseProfile(case_id=case_id, code=code, agency=agency)
        db.add(profile)
        db.flush()
    return profile


def preserve(
    db: Session,
    *,
    case_id: int,
    filename: str,
    kind: str,
    raw: bytes,
    source_org: str | None = None,
    document_id: int | None = None,
    actor: str = "system",
) -> EvidenceArtifact:
    """Keep the original bytes and record their receipt. Parses nothing.

    Deduplicated within a case only: the same bytes filed in another case are
    that case's own artifact, and nothing here reveals that the other exists.
    """
    sha = get_store().put(raw)
    existing = db.scalar(
        select(EvidenceArtifact).where(
            EvidenceArtifact.case_id == case_id, EvidenceArtifact.sha256 == sha
        )
    )
    if existing is not None:
        return existing

    artifact = EvidenceArtifact(
        case_id=case_id,
        document_id=document_id,
        sha256=sha,
        filename=filename,
        kind=kind,
        byte_size=len(raw),
        source_org=source_org,
        status="received",
    )
    db.add(artifact)
    db.flush()
    audit.record(
        db,
        actor,
        "evidence.received",
        f"artifact:{artifact.id}",
        {"case": case_code(db, case_id), "sha256": sha, "filename": filename, "kind": kind},
    )
    db.commit()
    return artifact


def extract_artifact(db: Session, artifact_id: int, *, announce: bool = True) -> EvidenceArtifact:
    """Parse a preserved original from the store, never from the upload buffer."""
    artifact = db.get(EvidenceArtifact, artifact_id)
    if artifact is None:
        raise NotFound(f"artifact {artifact_id}")
    if artifact.status == "parsed":
        return artifact

    code = case_code(db, artifact.case_id)
    try:
        raw = get_store().get(artifact.sha256)
        extraction = extract(raw, case=code, kind=artifact.kind, sha256=artifact.sha256)
    except (ExtractionError, IntegrityError, MissingOriginal) as exc:
        artifact.status = "failed"
        artifact.error = f"{type(exc).__name__}: {exc}"
        audit.record(
            db, "system", "evidence.failed", f"artifact:{artifact.id}", {"error": artifact.error}
        )
        db.commit()
        return artifact

    for item in extraction.items:
        db.add(
            EvidenceItem(
                case_id=artifact.case_id,
                artifact_id=artifact.id,
                locator_key=item.locator_key,
                locator=item.locator,
                content=item.content,
                content_sha256=digest(item.content.encode("utf-8")),
            )
        )
    for a in extraction.assertions:
        db.add(
            AssertionRow(
                case_id=artifact.case_id,
                artifact_id=artifact.id,
                key=a.key,
                item=a.item,
                predicate=a.predicate,
                subject=a.subject,
                object=a.object,
                starts_at=_iso(a.start),
                ends_at=_iso(a.end),
                polarity=a.polarity,
                kind=a.kind,
                detail=a.detail,
                amount=a.amount,
                subject_label=a.subject_label,
                object_label=a.object_label,
                text=a.text,
            )
        )
    artifact.status = "parsed"
    artifact.error = None
    artifact.extractor_version = extraction.method
    artifact.reference = extraction.reference
    artifact.source_reference = extraction.source_reference
    artifact.document_date = _iso(extraction.document_date)
    artifact.title = extraction.title
    artifact.warnings = extraction.warnings
    audit.record(
        db,
        "system",
        "evidence.parsed",
        f"artifact:{artifact.id}",
        {
            "items": len(extraction.items),
            "assertions": len(extraction.assertions),
            "extractor": EXTRACTOR_VERSION,
            "warnings": len(extraction.warnings),
        },
    )
    db.flush()
    if announce:
        _announce_new_evidence(db, artifact)
    db.commit()
    return artifact


def ingest(db: Session, **kwargs) -> EvidenceArtifact:
    """Preserve, then extract. The upload route and the demo loader both use this."""
    artifact = preserve(db, **kwargs)
    return extract_artifact(db, artifact.id)


def _announce_new_evidence(db: Session, artifact: EvidenceArtifact) -> None:
    """New evidence moves every workspace that can see it to a new version.

    The findings may now differ, and the history should say why they moved.
    """
    workspaces = db.scalars(select(Workspace)).all()
    for workspace in workspaces:
        if artifact.case_id not in (workspace.case_ids or []):
            continue
        workspace.decision_version += 1
        db.flush()
        owner = db.get(Principal, workspace.principal_id)
        ctx = context(db, workspace, owner)
        snapshot_findings(
            db, ctx, reason=f"New evidence parsed: {artifact.filename}", actor_id=None
        )


# --- Snapshot and projection ---------------------------------------------------------


@dataclass
class ArtifactView:
    id: int
    case_id: int
    code: str
    sha256: str
    filename: str
    kind: str
    source_org: str | None
    status: str
    byte_size: int
    document_date: str | None
    reference: str | None
    source_reference: str | None
    title: str | None
    received_at: datetime


@dataclass
class Context:
    """One workspace, resolved under one caller's current permissions."""

    workspace: Workspace
    principal: Principal
    codes: dict[int, str]
    case_names: dict[str, str]
    artifacts: dict[tuple[str, str], ArtifactView]
    snapshot: E.Snapshot
    baseline: E.Projection
    cache_key: tuple
    _projections: dict[str, E.Projection] = field(default_factory=dict)
    _tasks: list = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def subjects(self) -> list[str]:
        return sorted(self.baseline.anchors)

    def project(self, scenario: E.Scenario) -> E.Projection:
        if scenario == self.baseline.scenario:
            return self.baseline
        fingerprint = scenario.canonical()
        with self._lock:
            cached = self._projections.get(fingerprint)
        if cached is not None:
            return cached
        projection = E.derive(self.snapshot, scenario, subjects=self.subjects)
        with self._lock:
            self._projections[fingerprint] = projection
        return projection

    def artifact_of(self, assertion: E.Assertion) -> ArtifactView | None:
        return self.artifacts.get((assertion.case, assertion.artifact))

    def artifact_names(self) -> dict[str, str]:
        return {view.sha256: view.filename for view in self.artifacts.values()}


_CONTEXTS: OrderedDict[tuple, Context] = OrderedDict()
_CONTEXT_LOCK = threading.Lock()
_CONTEXT_LIMIT = 16


def clear_cache() -> None:
    with _CONTEXT_LOCK:
        _CONTEXTS.clear()


def _corpus_fingerprint(db: Session, case_ids: list[int]) -> tuple:
    count, newest = db.execute(
        select(func.count(EvidenceArtifact.id), func.max(EvidenceArtifact.id)).where(
            EvidenceArtifact.case_id.in_(case_ids), EvidenceArtifact.status == "parsed"
        )
    ).one()
    return (count, newest)


def context(db: Session, workspace: Workspace, principal: Principal) -> Context:
    """Load (or reuse) the snapshot and baseline for a workspace.

    The cache key carries the decision version, the caller's permission
    version and the corpus fingerprint, so a result computed under one set of
    grants or one body of evidence is never served under another.
    """
    case_ids = list(workspace.case_ids or [])
    key = (
        workspace.id,
        workspace.decision_version,
        access.permission_version(db, principal, case_ids),
        _corpus_fingerprint(db, case_ids),
    )
    with _CONTEXT_LOCK:
        cached = _CONTEXTS.get(key)
        if cached is not None:
            _CONTEXTS.move_to_end(key)
            return Context(**{**cached.__dict__, "workspace": workspace, "principal": principal})

    built = _build_context(db, workspace, principal, key)
    with _CONTEXT_LOCK:
        _CONTEXTS[key] = built
        while len(_CONTEXTS) > _CONTEXT_LIMIT:
            _CONTEXTS.popitem(last=False)
    return built


def _build_context(db: Session, workspace: Workspace, principal: Principal, key: tuple) -> Context:
    case_ids = list(workspace.case_ids or [])
    codes = {case_id: case_code(db, case_id) for case_id in case_ids}
    names = {
        codes[c.id]: c.name for c in db.scalars(select(core.Case).where(core.Case.id.in_(case_ids)))
    }

    views: dict[tuple[str, str], ArtifactView] = {}
    by_id: dict[int, ArtifactView] = {}
    for row in db.scalars(
        select(EvidenceArtifact).where(
            EvidenceArtifact.case_id.in_(case_ids), EvidenceArtifact.status == "parsed"
        )
    ):
        view = ArtifactView(
            id=row.id,
            case_id=row.case_id,
            code=codes[row.case_id],
            sha256=row.sha256,
            filename=row.filename,
            kind=row.kind,
            source_org=row.source_org,
            status=row.status,
            byte_size=row.byte_size,
            document_date=row.document_date,
            reference=row.reference,
            source_reference=row.source_reference,
            title=row.title,
            received_at=row.received_at,
        )
        views[(view.code, view.sha256)] = view
        by_id[row.id] = view

    assertions: list[E.Assertion] = []
    for row in db.scalars(
        select(AssertionRow)
        .where(AssertionRow.artifact_id.in_(list(by_id)))
        .order_by(AssertionRow.key)
    ):
        view = by_id[row.artifact_id]
        assertions.append(
            E.Assertion(
                key=row.key,
                case=view.code,
                artifact=view.sha256,
                item=row.item,
                predicate=row.predicate,
                subject=row.subject,
                object=row.object,
                start=_parse(row.starts_at),
                end=_parse(row.ends_at),
                polarity=row.polarity,
                kind=row.kind,
                detail=row.detail,
                amount=row.amount,
                subject_label=row.subject_label,
                object_label=row.object_label,
                text=row.text,
            )
        )

    infos = {
        (view.code, view.sha256): lineage.ArtifactInfo(
            sha256=view.sha256,
            case=view.code,
            filename=view.filename,
            kind=view.kind,
            reference=view.reference,
            source_reference=view.source_reference,
            document_date=_parse(view.document_date),
        )
        for view in views.values()
    }
    links = lineage.detect(assertions, infos)
    snapshot = E.Snapshot(
        cases=tuple(sorted(codes.values())),
        assertions=tuple(assertions),
        links=tuple(links),
        decisions=tuple(_latest_identity_decisions(db, workspace.id)),
        reviews=_latest(db, AssertionReview, AssertionReview.assertion_key, workspace.id),
        groupings=_latest(db, GroupingDecision, GroupingDecision.link_key, workspace.id),
    )
    return Context(
        workspace=workspace,
        principal=principal,
        codes=codes,
        case_names=names,
        artifacts=views,
        snapshot=snapshot,
        baseline=E.derive(snapshot),
        cache_key=key,
    )


def _latest(db: Session, model, column, workspace_id: int) -> dict[str, str]:
    rows = db.scalars(
        select(model).where(model.workspace_id == workspace_id).order_by(model.version, model.id)
    ).all()
    return {getattr(row, column.key): row.state for row in rows}


def _latest_identity_decisions(db: Session, workspace_id: int) -> list[E.IdentityDecision]:
    latest: dict[str, IdentityDecisionRow] = {}
    for row in db.scalars(
        select(IdentityDecisionRow)
        .where(IdentityDecisionRow.workspace_id == workspace_id)
        .order_by(IdentityDecisionRow.version, IdentityDecisionRow.id)
    ):
        latest[row.candidate_key] = row
    return [
        E.IdentityDecision(
            candidate=row.candidate_key,
            a=row.person_a,
            b=row.person_b,
            state=row.state,
            evidence=tuple(row.evidence_keys or ()),
        )
        for _, row in sorted(latest.items())
    ]


# --- Workspaces ----------------------------------------------------------------------


def create_workspace(
    db: Session, principal: Principal, *, case_ids: list[int], purpose: str, name: str
) -> Workspace:
    purpose = purpose.strip()
    if not purpose:
        raise InvalidRequest("A workspace needs a stated purpose.")
    requested = access.require_cases(db, principal, case_ids, purpose=purpose)
    if len(requested) < 2:
        raise InvalidRequest("Comparing cases needs at least two of them.")

    workspace = Workspace(
        name=name.strip() or "Untitled workspace",
        purpose=purpose,
        principal_id=principal.id,
        case_ids=requested,
        decision_version=0,
    )
    db.add(workspace)
    db.flush()
    audit.record(
        db,
        principal.handle,
        "workspace.created",
        f"workspace:{workspace.id}",
        {"cases": [case_code(db, c) for c in requested], "purpose": purpose},
    )
    ctx = context(db, workspace, principal)
    snapshot_findings(db, ctx, reason="Baseline computed", actor_id=principal.id)
    db.commit()
    return workspace


def purge_workspaces(db: Session, case_ids: list[int]) -> None:
    """Delete every workspace touching these cases, with everything decided in it."""
    doomed = [
        workspace.id
        for workspace in db.scalars(select(Workspace))
        if set(workspace.case_ids or []) & set(case_ids)
    ]
    if doomed:
        for model in (
            AssertionReview,
            IdentityDecisionRow,
            GroupingDecision,
            ScenarioRun,
            FindingSnapshot,
        ):
            db.execute(delete(model).where(model.workspace_id.in_(doomed)))
        db.execute(delete(Workspace).where(Workspace.id.in_(doomed)))
        db.flush()
    clear_cache()


def list_workspaces(db: Session, principal: Principal) -> list[Workspace]:
    visible = []
    for workspace in db.scalars(select(Workspace).order_by(Workspace.id)):
        try:
            access.require_workspace(db, principal, workspace.id)
        except access.AccessDenied:
            continue
        visible.append(workspace)
    return visible


def snapshot_findings(
    db: Session, ctx: Context, *, reason: str, actor_id: int | None
) -> FindingSnapshot:
    projection = ctx.baseline
    summary = {
        "findings": {
            key: {
                "status": finding.status,
                "title": _finding_title(ctx, finding),
                "explanations": [[x.key, x.status] for x in finding.explanations],
            }
            for key, finding in sorted(projection.findings.items())
        }
    }
    row = FindingSnapshot(
        workspace_id=ctx.workspace.id,
        version=ctx.workspace.decision_version,
        reason=reason,
        actor_id=actor_id,
        summary=summary,
    )
    db.add(row)
    db.flush()
    return row


def history(db: Session, ctx: Context) -> list[dict]:
    rows = db.scalars(
        select(FindingSnapshot)
        .where(FindingSnapshot.workspace_id == ctx.workspace.id)
        .order_by(FindingSnapshot.version)
    ).all()
    actors = {p.id: p for p in db.scalars(select(Principal))}
    return [
        {
            "version": row.version,
            "reason": row.reason,
            "actor": actors[row.actor_id].display_name if row.actor_id in actors else "System",
            "at": _iso(row.created_at),
            "statuses": {k: v["status"] for k, v in row.summary.get("findings", {}).items()},
            "titles": {k: v.get("title", k) for k, v in row.summary.get("findings", {}).items()},
        }
        for row in rows
    ]


# --- Decisions ---------------------------------------------------------------------------


def _check_version(workspace: Workspace, expected: int) -> None:
    if workspace.decision_version != expected:
        raise VersionConflict(
            f"The workspace is at version {workspace.decision_version}; you last saw {expected}. "
            "Reload and decide again."
        )


def _commit_decision(db: Session, workspace: Workspace, principal: Principal, reason: str) -> None:
    db.flush()
    ctx = context(db, workspace, principal)
    snapshot_findings(db, ctx, reason=reason, actor_id=principal.id)
    db.commit()


def decide_identity(
    db: Session,
    workspace: Workspace,
    principal: Principal,
    *,
    candidate: str,
    state: str,
    evidence: list[str],
    reason: str,
    expected_version: int,
) -> int:
    if state not in IDENTITY_DECISIONS:
        raise InvalidRequest(f"state must be one of {sorted(IDENTITY_DECISIONS)}")
    if not reason.strip():
        raise InvalidRequest("A decision needs a reason.")
    _check_version(workspace, expected_version)
    ctx = context(db, workspace, principal)
    found = ctx.baseline.candidates.get(candidate)
    if found is None:
        raise NotFound(candidate)
    known = set(ctx.baseline.active)
    cited = sorted(set(evidence))
    if state == "accepted" and not cited:
        raise InvalidRequest("Accepting an identity must cite the evidence it rests on.")
    if not set(cited) <= known:
        raise InvalidRequest("Cited evidence must be active assertions in this workspace.")

    workspace.decision_version += 1
    db.add(
        IdentityDecisionRow(
            workspace_id=workspace.id,
            candidate_key=candidate,
            person_a=found.a,
            person_b=found.b,
            state=state,
            evidence_keys=cited,
            reason=reason.strip(),
            actor_id=principal.id,
            version=workspace.decision_version,
        )
    )
    audit.record(
        db,
        principal.handle,
        f"identity.{state}",
        candidate,
        {"a": found.a, "b": found.b, "evidence": cited, "reason": reason.strip()},
    )
    label = f"{_person_label(ctx, found.a)} / {_person_label(ctx, found.b)}"
    _commit_decision(
        db,
        workspace,
        principal,
        f"{principal.display_name} {state} identity {label}: {reason.strip()}",
    )
    return workspace.decision_version


def review_assertion(
    db: Session,
    workspace: Workspace,
    principal: Principal,
    *,
    assertion: str,
    state: str,
    reason: str,
    expected_version: int,
    whole_passage: bool = True,
) -> int:
    """Record a reading of a statement. A passage is reviewed as a whole by
    default: a sentence that misreads a number misreads what it says with it."""
    if state not in REVIEW_STATES:
        raise InvalidRequest(f"state must be one of {sorted(REVIEW_STATES)}")
    if not reason.strip():
        raise InvalidRequest("A review needs a reason.")
    _check_version(workspace, expected_version)
    ctx = context(db, workspace, principal)
    by_key = ctx.snapshot.assertion_map()
    if assertion not in by_key:
        raise NotFound(assertion)
    keys = sensitivity._passage(ctx.snapshot, assertion) if whole_passage else {assertion}

    workspace.decision_version += 1
    for key in sorted(keys):
        db.add(
            AssertionReview(
                workspace_id=workspace.id,
                assertion_key=key,
                state=state,
                reason=reason.strip(),
                actor_id=principal.id,
                version=workspace.decision_version,
            )
        )
    target = by_key[assertion]
    view = ctx.artifact_of(target)
    audit.record(
        db,
        principal.handle,
        f"assertion.{state}",
        assertion,
        {
            "assertions": sorted(keys),
            "document": view.filename if view else None,
            "reason": reason.strip(),
        },
    )
    where = view.filename if view else "a source"
    _commit_decision(
        db,
        workspace,
        principal,
        f"{principal.display_name} {state} a passage in {where}: {reason.strip()}",
    )
    return workspace.decision_version


def decide_grouping(
    db: Session,
    workspace: Workspace,
    principal: Principal,
    *,
    link: str,
    state: str,
    reason: str,
    expected_version: int,
) -> int:
    if state not in GROUPING_DECISIONS:
        raise InvalidRequest(f"state must be one of {sorted(GROUPING_DECISIONS)}")
    if not reason.strip():
        raise InvalidRequest("A decision needs a reason.")
    _check_version(workspace, expected_version)
    ctx = context(db, workspace, principal)
    found = next((item for item in ctx.snapshot.links if item.key == link), None)
    if found is None:
        raise NotFound(link)

    workspace.decision_version += 1
    db.add(
        GroupingDecision(
            workspace_id=workspace.id,
            link_key=link,
            state=state,
            reason=reason.strip(),
            actor_id=principal.id,
            version=workspace.decision_version,
        )
    )
    audit.record(
        db,
        principal.handle,
        f"grouping.{state}",
        link,
        {"basis": found.basis, "reason": reason.strip()},
    )
    _commit_decision(
        db,
        workspace,
        principal,
        f"{principal.display_name} {state} a source grouping: {reason.strip()}",
    )
    return workspace.decision_version


def record_outcome(
    db: Session,
    workspace: Workspace,
    principal: Principal,
    *,
    task: str,
    outcome: str,
    reason: str,
    expected_version: int,
) -> int:
    """Record what checking a verification task found, as one versioned decision.

    One answer usually implies several reviews: finding that Anil Borade held a
    number on those dates disputes every passage that says someone else did.
    Recording them together keeps the history honest about it being one
    finding by one person, rather than a scatter of separate edits.
    """
    if not reason.strip():
        raise InvalidRequest("Recording an outcome needs a reason.")
    _check_version(workspace, expected_version)
    ctx = context(db, workspace, principal)
    found = next((t for t in _plan(ctx) if t.key == task), None)
    if found is None:
        raise NotFound(task)
    chosen = next((o for o in found.outcomes if o.key == outcome), None)
    if chosen is None:
        raise NotFound(outcome)

    version = workspace.decision_version + 1
    by_key = ctx.snapshot.assertion_map()
    written: dict[str, list[str]] = defaultdict(list)

    def review(keys, state: str) -> None:
        for key in sorted(keys):
            db.add(
                AssertionReview(
                    workspace_id=workspace.id,
                    assertion_key=key,
                    state=state,
                    reason=reason.strip(),
                    actor_id=principal.id,
                    version=version,
                )
            )
            written[f"assertion.{state}"].append(key)

    overrides = chosen.overrides
    if found.kind == "attribution" and outcome.startswith("holder:"):
        review(overrides.get("assertions", {}), "disputed")
        person = outcome.split(":", 1)[1]
        review({k for k in found.evidence if by_key[k].subject == person}, "accepted")
    elif found.kind == "identity":
        candidate = ctx.baseline.candidates[found.targets[0]]
        state = {"accept": "accepted", "reject": "rejected"}.get(outcome, "deferred")
        cited = sorted(k for k in found.evidence if k in ctx.baseline.active)
        db.add(
            IdentityDecisionRow(
                workspace_id=workspace.id,
                candidate_key=candidate.key,
                person_a=candidate.a,
                person_b=candidate.b,
                state=state,
                evidence_keys=cited if state == "accepted" else [],
                reason=reason.strip(),
                actor_id=principal.id,
                version=version,
            )
        )
        written[f"identity.{state}"].append(candidate.key)
    elif found.kind == "lineage":
        state = "rejected" if outcome == "independent" else "accepted"
        for link in found.targets:
            db.add(
                GroupingDecision(
                    workspace_id=workspace.id,
                    link_key=link,
                    state=state,
                    reason=reason.strip(),
                    actor_id=principal.id,
                    version=version,
                )
            )
            written[f"grouping.{state}"].append(link)
    elif found.kind == "critical_source":
        if outcome == "unreliable":
            # Setting a source aside is a review of everything it states,
            # recorded as such, not a scenario that quietly outlives the check.
            family = found.targets[0]
            review({k for k, f in ctx.baseline.families.items() if f == family}, "rejected")
        else:
            review(set(found.evidence), "accepted")

    workspace.decision_version = version
    audit.record(
        db,
        principal.handle,
        "task.recorded",
        task,
        {
            "kind": found.kind,
            "outcome": outcome,
            "label": chosen.label,
            "decisions": {k: sorted(v) for k, v in written.items()},
            "reason": reason.strip(),
        },
    )
    _commit_decision(
        db,
        workspace,
        principal,
        f"{principal.display_name} checked “{found.title}”: {chosen.label}. {reason.strip()}",
    )
    return workspace.decision_version


# --- Scenarios ---------------------------------------------------------------------------


def validate_scenario(ctx: Context, definition: dict) -> E.Scenario:
    """Build a scenario, refusing anything that names what the workspace lacks."""
    try:
        scenario = E.Scenario.from_dict(definition)
    except (TypeError, ValueError) as exc:
        raise InvalidRequest(f"Malformed scenario: {exc}") from exc
    families = set(ctx.baseline.families.values())
    unknown = scenario.exclude_families - families
    if unknown:
        raise InvalidRequest(f"Unknown source families: {sorted(unknown)}")
    for key, state in scenario.identity:
        if key not in ctx.baseline.candidates or state not in {"accepted", "rejected"}:
            raise InvalidRequest(f"Bad identity override {key}={state}")
    keys = {a.key for a in ctx.snapshot.assertions}
    for key, state in scenario.assertions:
        if key not in keys or state not in REVIEW_STATES:
            raise InvalidRequest(f"Bad assertion override {key}={state}")
    links = {link.key for link in ctx.snapshot.links}
    for key, state in scenario.groupings:
        if key not in links or state not in GROUPING_DECISIONS:
            raise InvalidRequest(f"Bad grouping override {key}={state}")
    if not 0 <= scenario.claim_window_days <= 60:
        raise InvalidRequest("claim_window_days must be between 0 and 60")
    if not 1 <= scenario.max_hops <= 5:
        raise InvalidRequest("max_hops must be between 1 and 5")
    if scenario.naive:
        raise InvalidRequest("The naive contrast is not a scenario; use the contrast view.")
    return scenario


def run_scenario(
    db: Session,
    workspace: Workspace,
    principal: Principal,
    *,
    name: str,
    definition: dict,
    idempotency_key: str | None = None,
) -> ScenarioRun:
    if idempotency_key:
        existing = db.scalar(
            select(ScenarioRun).where(
                ScenarioRun.workspace_id == workspace.id,
                ScenarioRun.created_by == principal.id,
                ScenarioRun.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            return existing

    ctx = context(db, workspace, principal)
    run = ScenarioRun(
        workspace_id=workspace.id,
        name=name.strip() or "Scenario",
        definition=definition,
        baseline_version=workspace.decision_version,
        status="running",
        created_by=principal.id,
        idempotency_key=idempotency_key,
    )
    db.add(run)
    db.flush()
    try:
        scenario = validate_scenario(ctx, definition)
        run.definition = scenario.to_dict()
        run.result = compare(ctx, ctx.baseline, ctx.project(scenario))
        run.status = "complete"
    except InvalidRequest as exc:
        run.status = "failed"
        run.error = str(exc)
    except Exception as exc:  # a failed run must never read as a completed one
        logger.exception("Scenario %s failed", run.id)
        run.status = "failed"
        run.error = f"{type(exc).__name__}: {exc}"
    audit.record(
        db,
        principal.handle,
        f"scenario.{run.status}",
        f"scenario:{run.id}",
        {"workspace": workspace.id, "definition": run.definition, "error": run.error},
    )
    db.commit()
    return run


def scenario_out(run: ScenarioRun, workspace: Workspace) -> dict:
    status = run.status
    if status == "complete" and run.baseline_version != workspace.decision_version:
        status = "stale"
    return {
        "id": run.id,
        "name": run.name,
        "status": status,
        "definition": run.definition,
        "baseline_version": run.baseline_version,
        "current_version": workspace.decision_version,
        "result": run.result if run.status == "complete" else None,
        "error": run.error,
        "created_at": _iso(run.created_at),
    }


def compare(ctx: Context, base: E.Projection, alt: E.Projection) -> dict:
    """What changed between a baseline and a scenario, finding by finding."""
    rows = []
    for key in sorted(set(base.findings) | set(alt.findings)):
        before = base.findings.get(key)
        after = alt.findings.get(key)
        either = before or after
        old = {x.key: x for x in before.explanations} if before else {}
        new = {x.key: x for x in after.explanations} if after else {}
        rows.append(
            {
                "key": key,
                "title": _finding_title(ctx, either),
                "before": before.status if before else E.UNSUPPORTED,
                "after": after.status if after else E.UNSUPPORTED,
                "changed": (before.status if before else None) != (after.status if after else None),
                "explanations": {
                    "kept": [_chain(ctx, new[k]) for k in sorted(old.keys() & new.keys())],
                    "lost": [_chain(ctx, old[k]) for k in sorted(old.keys() - new.keys())],
                    "gained": [_chain(ctx, new[k]) for k in sorted(new.keys() - old.keys())],
                },
            }
        )
    weakened = [
        key
        for key in base.edges.keys() & alt.edges.keys()
        if alt.edges[key].derivations < base.edges[key].derivations
    ]
    return {
        "findings": rows,
        "edges": {
            "removed": len(base.edges.keys() - alt.edges.keys()),
            "added": len(alt.edges.keys() - base.edges.keys()),
            "weakened": len(weakened),
        },
        "people": {
            "removed": sorted(
                _person_label(ctx, k, base) for k in base.persons.keys() - alt.persons.keys()
            ),
            "added": sorted(
                _person_label(ctx, k, alt) for k in alt.persons.keys() - base.persons.keys()
            ),
        },
        "conflicts": {"before": len(base.conflicts), "after": len(alt.conflicts)},
        "active_assertions": {"before": len(base.active), "after": len(alt.active)},
    }


# --- Presentation ---------------------------------------------------------------------------


def _person_label(ctx: Context, key: str, projection: E.Projection | None = None) -> str:
    projection = projection or ctx.baseline
    person = projection.persons.get(key)
    if person is None:
        return key.split(":", 2)[-1].title() if is_person(key) else key
    return person.label


def person_out(ctx: Context, key: str, projection: E.Projection | None = None) -> dict:
    projection = projection or ctx.baseline
    person = projection.persons.get(key)
    case = person.case if person else key.split(":", 2)[1]
    return {
        "key": key,
        "label": _person_label(ctx, key, projection),
        "case": case,
        "case_name": ctx.case_names.get(case, case),
        "hub": key in projection.hubs,
        "accused": key in projection.anchors,
    }


def _finding_title(ctx: Context, finding: E.Finding) -> str:
    a, b = _person_label(ctx, finding.a), _person_label(ctx, finding.b)
    return f"{a} ({finding.case_a}) and {b} ({finding.case_b})"


def _chain(
    ctx: Context, explanation: E.Explanation, projection: E.Projection | None = None
) -> dict:
    labels: list[str] = []
    for node in explanation.nodes:
        label = _person_label(ctx, node, projection)
        if not labels or labels[-1] != label:
            labels.append(label)
    return {"key": explanation.key, "status": explanation.status, "chain": labels}


def _family_docs(ctx: Context, projection: E.Projection) -> dict[str, list[tuple[str, str]]]:
    """Family -> (filename, case code) of each document it holds statements from,
    the origin first."""
    by_key = ctx.snapshot.assertion_map()
    docs: dict[str, dict[tuple[str, str], bool]] = defaultdict(dict)
    for key, family in projection.families.items():
        assertion = by_key[key]
        view = ctx.artifact_of(assertion)
        if view is None:
            continue
        document = (view.filename, view.code)
        is_origin = key == projection.roots[key]
        docs[family][document] = docs[family].get(document, False) or is_origin
    return {
        family: sorted(files, key=lambda document: (not files[document], document))
        for family, files in docs.items()
    }


def family_out(ctx: Context, family: str, docs: dict[str, list[tuple[str, str]]]) -> dict:
    documents = docs.get(family, [])
    files = [filename for filename, _ in documents]
    return {
        "key": family,
        "origin": files[0] if files else family,
        "documents": files,
        "cases": sorted({case for _, case in documents}),
        "label": files[0] + (f" + {len(files) - 1} repeating it" if len(files) > 1 else "")
        if files
        else family,
    }


def _summary(ctx: Context, a: E.Assertion) -> str:
    def day(value: datetime | None) -> str:
        return value.astimezone(IST).strftime("%d %b %Y") if value else "open"

    def moment(value: datetime | None) -> str:
        return value.astimezone(IST).strftime("%d %b %Y %H:%M IST") if value else "undated"

    if a.predicate == E.HOLDS:
        ident = identifier_value(a.object or "")
        kind = "mobile" if identifier_type(a.object or "") == "PHONE" else "account"
        if a.kind == E.RECORD:
            role = "registered mobile" if a.detail == "registered mobile" else f"{kind}"
            last = (a.end - E.ONE_DAY) if a.end else None
            period = f"{day(a.start)} to {day(last)}"
            return f"{role.capitalize()} {ident} registered to {a.subject_label}, {period}"
        verb = "denied using" if a.polarity < 0 else "said to use"
        return f"{a.subject_label} {verb} {kind} {ident} around {day(a.start)}"
    if a.predicate == E.CONTACT:
        length = f", {a.detail}" if a.detail else ""
        return (
            f"{identifier_value(a.subject)} called {identifier_value(a.object or '')} at "
            f"{moment(a.start)}{length}"
        )
    if a.predicate == E.TRANSFER:
        return (
            f"Account {identifier_value(a.subject)} paid {identifier_value(a.object or '')} "
            f"Rs. {a.amount:,.0f} at {moment(a.start)}"
        )
    if a.predicate == E.LINK:
        verbs = {
            "called": "in contact with",
            "paid": "paid",
            "denied": "denied knowing",
            "associated": "associated with",
        }
        return f"{a.subject_label} {verbs.get(a.detail or '', 'linked to')} {a.object_label}"
    if a.predicate == E.ACCUSED:
        return f"{a.subject_label} named as accused"
    return a.text


class Refs:
    """Everything one response mentions, each serialised once.

    A finding's explanations name the same people, statements and source
    families many times over; embedding them at every mention made a single
    finding weigh most of a megabyte. Responses carry these tables instead and
    refer into them by key.
    """

    def __init__(
        self,
        ctx: Context,
        projection: E.Projection,
        items: dict[tuple[int, str], EvidenceItem],
    ) -> None:
        self.ctx = ctx
        self.projection = projection
        self.items = items
        self.by_key = ctx.snapshot.assertion_map()
        self.docs = _family_docs(ctx, projection)
        self.states = {**ctx.snapshot.reviews, **dict(projection.scenario.assertions)}
        self.links = {
            link.derivative: link
            for link in ctx.snapshot.links
            if projection.roots.get(link.derivative) != link.derivative
        }
        self.people: dict[str, dict] = {}
        self.evidence: dict[str, dict] = {}
        self.families: dict[str, dict] = {}

    def person(self, key: str) -> str:
        if key not in self.people:
            self.people[key] = person_out(self.ctx, key, self.projection)
        return key

    def family(self, key: str) -> str:
        if key not in self.families:
            self.families[key] = family_out(self.ctx, key, self.docs)
        return key

    def facts(self, keys) -> list[str]:
        found = []
        for key in keys:
            a = self.by_key.get(key)
            if a is None:
                continue
            if key not in self.evidence:
                self.evidence[key] = self._fact(a)
            found.append(key)
        return found

    def _fact(self, a: E.Assertion) -> dict:
        ctx = self.ctx
        view = ctx.artifact_of(a)
        item = self.items.get((view.id, a.item)) if view else None
        family = self.projection.families.get(a.key)
        link = self.links.get(a.key)
        origin = self.by_key.get(link.origin) if link else None
        origin_view = ctx.artifact_of(origin) if origin else None
        return {
            "key": a.key,
            "kind": a.kind,
            "predicate": a.predicate,
            "summary": _summary(ctx, a),
            "text": item.content if item else a.text,
            "locator": item.locator if item else {"key": a.item},
            # Statements from one row or sentence share a passage, and are
            # reviewed together by default.
            "passage": f"{view.id}:{a.item}" if view else a.item,
            "document": {
                "id": view.id,
                "filename": view.filename,
                "case": view.code,
                "kind": view.kind,
                "source_org": view.source_org,
            }
            if view
            else None,
            "time": _iso(a.start),
            "family": self.family(family) if family else None,
            "lineage": {
                "basis": link.basis,
                "status": ctx.snapshot.groupings.get(link.key, link.status),
                "link": link.key,
                "origin_document": origin_view.filename if origin_view else None,
                "note": link.note,
            }
            if link
            else None,
            "review": self.states.get(a.key),
            "active": a.key in self.projection.active,
        }

    def tables(self) -> dict:
        return {"people": self.people, "evidence": self.evidence, "families": self.families}


def _load_items(db: Session, ctx: Context, keys: set[str]) -> dict[tuple[int, str], EvidenceItem]:
    by_key = ctx.snapshot.assertion_map()
    wanted: dict[int, set[str]] = defaultdict(set)
    for key in keys:
        a = by_key.get(key)
        view = ctx.artifact_of(a) if a else None
        if view:
            wanted[view.id].add(a.item)
    found: dict[tuple[int, str], EvidenceItem] = {}
    for artifact_id, locators in wanted.items():
        for item in db.scalars(
            select(EvidenceItem).where(
                EvidenceItem.artifact_id == artifact_id, EvidenceItem.locator_key.in_(locators)
            )
        ):
            found[(artifact_id, item.locator_key)] = item
    return found


def _contested_items(ctx: Context, projection: E.Projection) -> set[tuple[str, str]]:
    """Passages whose claim about who held a number a record contradicts."""
    by_key = ctx.snapshot.assertion_map()
    contested: set[tuple[str, str]] = set()
    for conflict in projection.conflicts:
        holders = [by_key[h] for _, h in conflict.holders]
        if any(h.kind == E.RECORD for h in holders):
            for holding in holders:
                if holding.kind == E.CLAIM:
                    contested.add((holding.artifact, holding.item))
    # Copies of a contested passage are contested with it.
    for key, root in projection.roots.items():
        origin = by_key[root]
        if (origin.artifact, origin.item) in contested:
            copy = by_key[key]
            contested.add((copy.artifact, copy.item))
    return contested


def _derivation_is_contested(
    derivation: frozenset[str], by_key: dict[str, E.Assertion], contested: set[tuple[str, str]]
) -> bool:
    return any(
        (by_key[atom].artifact, by_key[atom].item) in contested
        for atom in derivation
        if atom in by_key
    )


def _counts(ctx: Context, projection: E.Projection, atoms: set[str]) -> dict:
    by_key = ctx.snapshot.assertion_map()
    assertions = [by_key[a] for a in atoms if a in by_key]
    return {
        "observations": len(assertions),
        "documents": len({(a.case, a.artifact) for a in assertions}),
        "origins": len({projection.families[a.key] for a in assertions}),
        "records": sum(1 for a in assertions if a.kind == E.RECORD),
        "claims": sum(1 for a in assertions if a.kind == E.CLAIM),
    }


def _edge_out(refs: Refs, edge: E.Edge, contested: set[tuple[str, str]]) -> dict:
    by_key = refs.by_key
    # Uncontested derivations first: the reader should see the firmest support.
    ordered = sorted(
        edge.derivations,
        key=lambda d: (_derivation_is_contested(d, by_key, contested), sorted(d)),
    )
    shown = []
    for derivation in ordered[:MAX_DERIVATIONS_SHOWN]:
        keys = sorted(a for a in derivation if a in by_key)
        identity = sorted(a.split(":", 1)[1] for a in derivation if a.startswith("id:"))
        shown.append(
            {
                "evidence": refs.facts(keys),
                "identity": identity,
                "contested": _derivation_is_contested(derivation, by_key, contested),
            }
        )
    all_contested = all(_derivation_is_contested(d, by_key, contested) for d in edge.derivations)
    atoms = {a for d in edge.derivations for a in d if a in by_key}
    return {
        "key": edge.key,
        "type": edge.type,
        "source": refs.person(edge.source),
        "target": refs.person(edge.target),
        "directed": edge.directed,
        "provisional": edge.provisional,
        "derivations": shown,
        "derivation_count": len(edge.derivations),
        "counts": _counts(refs.ctx, refs.projection, atoms),
        "contested": all_contested,
    }


def finding_summary(ctx: Context, projection: E.Projection, finding: E.Finding) -> dict:
    atoms: set[str] = set()
    for explanation in finding.explanations:
        atoms |= E.explanation_atoms(explanation, projection.edges)
    best = finding.explanations[0] if finding.explanations else None
    return {
        "key": finding.key,
        "title": _finding_title(ctx, finding),
        "status": finding.status,
        "a": person_out(ctx, finding.a, projection),
        "b": person_out(ctx, finding.b, projection),
        "case_a": finding.case_a,
        "case_b": finding.case_b,
        "distance": finding.distance,
        "explanation_count": len(finding.explanations),
        "supported_explanations": sum(1 for x in finding.explanations if x.status == E.SUPPORTED),
        "paths_found": finding.paths_found,
        "truncated": finding.truncated,
        "headline": _chain(ctx, best, projection) if best else None,
        "counts": _counts(ctx, projection, atoms),
        "assumptions": {
            "provisional_identities": len({c for x in finding.explanations for c in x.provisional}),
            "hubs": len({h for x in finding.explanations for h in x.hubs}),
        },
    }


def finding_detail(db: Session, ctx: Context, projection: E.Projection, finding: E.Finding) -> dict:
    by_key = ctx.snapshot.assertion_map()
    contested = _contested_items(ctx, projection)

    used_edges = {key for x in finding.explanations for step in x.steps for key in step.edges}
    atoms: set[str] = set()
    for key in used_edges:
        if key in projection.edges:
            atoms |= {a for d in projection.edges[key].derivations for a in d}
    event_keys = {
        a for a in atoms if a in by_key and by_key[a].predicate in (E.CONTACT, E.TRANSFER)
    }
    conflicts = [c for c in projection.conflicts if c.event in event_keys]
    conflict_holdings = {h for c in conflicts for _, h in c.holders}
    candidate_keys = sorted({c for x in finding.explanations for c in x.provisional})
    candidate_holdings = {
        h
        for c in candidate_keys
        if c in projection.candidates
        for s in projection.candidates[c].shared
        for h in (s.holding_a, s.holding_b)
    }
    denial_keys = {key for _, _, key in projection.denials}
    items = _load_items(
        db, ctx, (atoms | conflict_holdings | candidate_holdings | denial_keys) & set(by_key)
    )
    refs = Refs(ctx, projection, items)

    explanations = []
    for explanation in finding.explanations:
        x_atoms = E.explanation_atoms(explanation, projection.edges)
        steps = []
        for index, step in enumerate(explanation.steps):
            edges = [
                _edge_out(refs, projection.edges[key], contested)
                for key in step.edges
                if key in projection.edges
            ]
            steps.append(
                {
                    "index": index,
                    "source": refs.person(step.source),
                    "target": refs.person(step.target),
                    "identity": step.identity,
                    "provisional": step.provisional,
                    "edges": edges,
                    "contested": bool(edges) and all(e["contested"] for e in edges),
                }
            )
        families = sorted({projection.families[a] for a in x_atoms if a in projection.families})
        explanations.append(
            {
                **_chain(ctx, explanation, projection),
                "hops": explanation.hops,
                "nodes": [refs.person(n) for n in explanation.nodes],
                "steps": steps,
                "provisional": list(explanation.provisional),
                "hubs": [refs.person(h) for h in explanation.hubs],
                "alternatives": explanation.alternatives,
                "counts": _counts(ctx, projection, x_atoms),
                "families": [refs.family(f) for f in families],
                "contested": any(s["contested"] for s in steps),
            }
        )

    return {
        **finding_summary(ctx, projection, finding),
        "version": ctx.workspace.decision_version,
        "explanations": explanations,
        "contrary": _contrary(refs, conflicts, finding),
        "candidates": [
            candidate_out(refs, projection.candidates[c])
            for c in candidate_keys
            if c in projection.candidates
        ],
        "timeline": _timeline(
            ctx, projection, event_keys, conflict_holdings | candidate_holdings | atoms
        ),
        "scenario": projection.scenario.to_dict(),
        **refs.tables(),
    }


def _contrary(refs: Refs, conflicts: list[E.Conflict], finding: E.Finding) -> list[dict]:
    by_key = refs.by_key
    projection = refs.projection
    grouped: dict[tuple[str, frozenset[str]], dict] = {}
    for conflict in conflicts:
        people = frozenset(person for person, _ in conflict.holders)
        group = grouped.setdefault((conflict.identifier, people), {"events": [], "holdings": set()})
        group["events"].append(conflict.event)
        group["holdings"].update(h for _, h in conflict.holders)
    out = []
    for (identifier, people), group in sorted(grouped.items(), key=lambda kv: kv[0][0]):
        moments = sorted(by_key[e].start for e in group["events"])
        out.append(
            {
                "kind": "attribution",
                "identifier": identifier_value(identifier),
                "events": len(group["events"]),
                "from": _iso(moments[0]),
                "to": _iso(moments[-1]),
                "holders": [refs.person(p) for p in sorted(people)],
                "evidence": refs.facts(sorted(group["holdings"])),
            }
        )
    people_in = {n for x in finding.explanations for n in x.nodes}
    for left, right, key in projection.denials:
        if left in people_in and right in people_in:
            out.append(
                {
                    "kind": "denial",
                    "holders": [refs.person(left), refs.person(right)],
                    "evidence": refs.facts([key]),
                }
            )
    return out


def candidate_out(refs: Refs, candidate: E.Candidate) -> dict:
    shared: dict[str, dict] = {}
    for s in candidate.shared:
        entry = shared.setdefault(
            s.identifier,
            {"identifier": identifier_value(s.identifier), "overlapping": False, "holdings": set()},
        )
        entry["overlapping"] = entry["overlapping"] or s.overlapping
        entry["holdings"].update({s.holding_a, s.holding_b})
    return {
        "key": candidate.key,
        "a": refs.person(candidate.a),
        "b": refs.person(candidate.b),
        "name_match": candidate.name_match,
        "status": candidate.status,
        "provisional": candidate.provisional,
        "in_effect": candidate.in_effect,
        "shared": [
            {
                "identifier": entry["identifier"],
                "overlapping": entry["overlapping"],
                "evidence": refs.facts(sorted(entry["holdings"])),
            }
            for _, entry in sorted(shared.items())
        ],
    }


def _identifier_kind(identifier: str) -> str:
    return "phone" if identifier_type(identifier) == "PHONE" else "account"


def _timeline(
    ctx: Context, projection: E.Projection, event_keys: set[str], holding_keys: set[str]
) -> dict:
    """Events on the finding's relationships, and who held each number when.

    Every holding of every number the events use is shown, including records a
    scenario has set aside: a number's full history is what makes a
    reassignment visible, and the lane for 9867012345 would otherwise start at
    the claim that the history contradicts.
    """
    by_key = ctx.snapshot.assertion_map()
    window = projection.scenario.claim_window_days
    events = []
    edge_of: dict[str, list[E.Edge]] = defaultdict(list)
    for edge in projection.edges.values():
        for derivation in edge.derivations:
            for atom in derivation & event_keys:
                edge_of[atom].append(edge)

    def who(person: str) -> str:
        return f"{_person_label(ctx, person, projection)} ({case_of(person)})"

    numbers: set[str] = set()
    for key in sorted(event_keys, key=lambda k: (by_key[k].start, k)):
        a = by_key[key]
        view = ctx.artifact_of(a)
        numbers.update(n for n in (a.subject, a.object) if n)
        readings = sorted({(who(e.source), who(e.target)) for e in edge_of.get(key, [])})
        events.append(
            {
                "key": key,
                "type": "call" if a.predicate == E.CONTACT else "transfer",
                "identifier_type": "phone" if a.predicate == E.CONTACT else "account",
                "at": _iso(a.start),
                "from": identifier_value(a.subject),
                "to": identifier_value(a.object or ""),
                "amount": a.amount,
                "document": view.filename if view else None,
                "readings": [{"source": s, "target": t} for s, t in readings],
            }
        )

    history = {
        a.key for a in ctx.snapshot.assertions if a.predicate == E.HOLDS and a.object in numbers
    }
    holdings = []
    wanted = (holding_keys & set(by_key)) | history
    for key in sorted(k for k in wanted if by_key[k].predicate == E.HOLDS):
        a = by_key[key]
        view = ctx.artifact_of(a)
        start, end = a.start, a.end
        if a.kind == E.CLAIM and a.start is not None:
            # A claim is drawn as the window the scenario lets it reach.
            start = a.start - timedelta(days=window)
            end = a.start + timedelta(days=window + 1)
        holdings.append(
            {
                "key": key,
                "identifier": identifier_value(a.object or ""),
                "identifier_type": _identifier_kind(a.object or ""),
                "person": who(a.subject),
                "kind": a.kind,
                "polarity": a.polarity,
                "start": _iso(start),
                "end": _iso(end),
                "stated": _iso(a.start) if a.kind == E.CLAIM else None,
                "document": view.filename if view else None,
                "active": key in projection.active,
            }
        )
    moments = [e["at"] for e in events]
    return {
        "events": events,
        "holdings": holdings,
        "range": [min(moments), max(moments)] if moments else None,
        "claim_window_days": window,
    }


def sensitivity_out(ctx: Context, projection: E.Projection, finding: E.Finding) -> dict:
    report = sensitivity.analyse(ctx.snapshot, projection, finding)
    docs = _family_docs(ctx, projection)
    by_key = ctx.snapshot.assertion_map()

    def alternative(alt: sensitivity.Alternative) -> dict:
        if alt.kind == "identity":
            candidate = projection.candidates[alt.subject]
            left = f"{_person_label(ctx, candidate.a, projection)} ({case_of(candidate.a)})"
            right = f"{_person_label(ctx, candidate.b, projection)} ({case_of(candidate.b)})"
            label = f"{left} and {right} are different people"
        else:
            holding = by_key[alt.subject]
            view = ctx.artifact_of(holding)
            label = f"{_summary(ctx, holding)} is wrong ({view.filename if view else 'source'})"
        return {
            "kind": alt.kind,
            "subject": alt.subject,
            "label": label,
            "status": alt.status,
            "changes": alt.status != finding.status,
        }

    return {
        "finding": finding.key,
        "status": finding.status,
        "limits": {
            "max_set_size": report.max_set_size,
            "units_searched": len(report.units),
            "units_total": report.units_total,
            "exhaustive": report.exhaustive,
            "evaluations": report.evaluations,
            "max_hops": projection.scenario.max_hops,
            "claim_window_days": projection.scenario.claim_window_days,
        },
        "breaking": [
            {"families": [family_out(ctx, f, docs) for f in s.families], "status": s.status}
            for s in report.breaking
        ],
        "downgrading": [
            {"families": [family_out(ctx, f, docs) for f in s.families], "status": s.status}
            for s in report.downgrading
        ],
        "critical": [family_out(ctx, f, docs) for f in report.critical],
        "alternatives": [alternative(a) for a in report.alternatives],
    }


def tasks_out(ctx: Context, finding_key: str | None = None) -> list[dict]:
    """The workspace queue, or the tasks bearing on one finding: those that
    would change its status, and those whose records its explanations use."""
    tasks = _plan(ctx)
    if finding_key is None:
        return [task_out(ctx, task) for task in tasks]
    finding = ctx.baseline.findings.get(finding_key)
    if finding is None:
        return []
    atoms: set[str] = set()
    for explanation in finding.explanations:
        atoms |= E.explanation_atoms(explanation, ctx.baseline.edges)
    return [
        task_out(ctx, task)
        for task in tasks
        if finding_key in task.affected or atoms & set(task.evidence)
    ]


def _plan(ctx: Context) -> list[verification.Task]:
    with ctx._lock:
        if ctx._tasks:
            return ctx._tasks
    tasks = verification.plan(ctx.snapshot, ctx.baseline, ctx.artifact_names())
    with ctx._lock:
        ctx._tasks[:] = tasks
    return tasks


def task_out(ctx: Context, task: verification.Task) -> dict:
    by_key = ctx.snapshot.assertion_map()
    baseline = ctx.baseline

    def title(key: str) -> str:
        finding = baseline.findings.get(key)
        return _finding_title(ctx, finding) if finding else key

    return {
        "key": task.key,
        "kind": task.kind,
        "grounds": task.grounds,
        "title": task.title,
        "question": task.question,
        "evidence": [
            {
                "key": k,
                "summary": _summary(ctx, by_key[k]),
                "kind": by_key[k].kind,
                "document": (
                    ctx.artifact_of(by_key[k]).filename if ctx.artifact_of(by_key[k]) else None
                ),
            }
            for k in task.evidence
            if k in by_key
        ],
        "effort": task.effort,
        "availability": task.availability,
        "status_changes": task.status_changes,
        "explanation_changes": task.explanation_changes,
        "affected": [{"key": k, "title": title(k)} for k in task.affected],
        "outcomes": [
            {
                "key": outcome.key,
                "label": outcome.label,
                "overrides": outcome.overrides,
                "changes": [
                    {
                        "finding": k,
                        "title": title(k),
                        "from": baseline.findings[k].status
                        if k in baseline.findings
                        else E.UNSUPPORTED,
                        "to": outcome.statuses.get(k, E.UNSUPPORTED),
                    }
                    for k in task.affected
                ],
            }
            for outcome in task.outcomes
        ],
    }


def contrast(ctx: Context) -> dict:
    """What an ordinary resolved graph would report, beside what this one does."""
    naive = E.derive(ctx.snapshot, E.Scenario.build(naive=True))
    by_key = ctx.snapshot.assertion_map()
    ours = {
        (finding.a.split(":", 2)[2], finding.b.split(":", 2)[2]): finding
        for finding in ctx.baseline.findings.values()
    }
    rows = []
    for finding in naive.findings.values():
        a_name, b_name = finding.a.split(":", 2)[2], finding.b.split(":", 2)[2]
        best = finding.explanations[0]
        atoms = E.explanation_atoms(best, naive.edges)
        assertions = [by_key[k] for k in atoms if k in by_key]
        mine = ours.get((a_name, b_name)) or ours.get((b_name, a_name))
        rows.append(
            {
                "a": naive.persons[finding.a].label,
                "b": naive.persons[finding.b].label,
                "cases": [finding.case_a, finding.case_b],
                "naive_status": finding.status,
                "naive_chain": [naive.persons[n].label for n in best.nodes],
                "naive_support": {
                    "documents": len({(a.case, a.artifact) for a in assertions}),
                    "records": sum(1 for a in assertions if a.kind == E.RECORD),
                    "claims": sum(1 for a in assertions if a.kind == E.CLAIM),
                },
                "ours": {
                    "key": mine.key,
                    "status": mine.status,
                    "headline": _chain(ctx, mine.explanations[0]) if mine.explanations else None,
                }
                if mine
                else None,
            }
        )
    rows.sort(key=lambda r: (r["cases"], r["a"], r["b"]))
    return {
        "rules": [
            "Every person with the same name is one person, across all cases.",
            "Every number belongs to everyone ever recorded against it, at every moment.",
            "Every document counts as an independent source.",
        ],
        "findings": rows,
    }


# --- Artifacts and export --------------------------------------------------------------------


def artifacts_out(ctx: Context) -> list[dict]:
    """Originals in the workspace, each re-hashed against its stored bytes."""
    store = get_store()
    return [
        {
            "id": view.id,
            "case": view.code,
            "case_name": ctx.case_names.get(view.code, view.code),
            "filename": view.filename,
            "kind": view.kind,
            "source_org": view.source_org,
            "sha256": view.sha256,
            "bytes": view.byte_size,
            "document_date": view.document_date,
            "reference": view.reference,
            "source_reference": view.source_reference,
            "received_at": _iso(view.received_at),
            "integrity": store.verify(view.sha256),
        }
        for view in sorted(ctx.artifacts.values(), key=lambda v: (v.code, v.filename))
    ]


def artifact_detail(db: Session, ctx: Context, artifact_id: int) -> dict:
    view = next((v for v in ctx.artifacts.values() if v.id == artifact_id), None)
    if view is None:
        raise NotFound(f"artifact {artifact_id}")
    store = get_store()
    integrity = store.verify(view.sha256)
    text = None
    if integrity == "intact":
        text = store.get(view.sha256).decode("utf-8-sig", errors="replace")
    items = db.scalars(
        select(EvidenceItem).where(EvidenceItem.artifact_id == view.id).order_by(EvidenceItem.id)
    ).all()
    by_item: dict[str, list[str]] = defaultdict(list)
    for a in ctx.snapshot.assertions:
        if a.artifact == view.sha256 and a.case == view.code:
            by_item[a.item].append(a.key)
    return {
        **next(a for a in artifacts_out(ctx) if a["id"] == artifact_id),
        "text": text,
        "items": [
            {
                "locator_key": item.locator_key,
                "locator": item.locator,
                "content": item.content,
                "assertions": by_item.get(item.locator_key, []),
            }
            for item in items
        ],
    }


def families_out(ctx: Context) -> list[dict]:
    docs = _family_docs(ctx, ctx.baseline)
    members: dict[str, int] = defaultdict(int)
    kinds: dict[str, set[str]] = defaultdict(set)
    by_key = ctx.snapshot.assertion_map()
    for key, family in ctx.baseline.families.items():
        if key in ctx.baseline.active:
            members[family] += 1
            kinds[family].add(by_key[key].kind)
    return [
        {
            **family_out(ctx, family, docs),
            "statements": members[family],
            "kinds": sorted(kinds[family]),
        }
        for family in sorted(members, key=lambda f: (docs.get(f, [(f, "")])[0], f))
    ]


def lineage_out(ctx: Context) -> list[dict]:
    by_key = ctx.snapshot.assertion_map()
    out = []
    for link in ctx.snapshot.links:
        derivative, origin = by_key[link.derivative], by_key[link.origin]
        out.append(
            {
                "key": link.key,
                "basis": link.basis,
                "status": ctx.snapshot.groupings.get(link.key, link.status),
                "proposed_status": link.status,
                "score": link.score,
                "note": link.note,
                "derivative": {
                    "assertion": derivative.key,
                    "summary": _summary(ctx, derivative),
                    "document": ctx.artifact_of(derivative).filename,
                },
                "origin": {
                    "assertion": origin.key,
                    "summary": _summary(ctx, origin),
                    "document": ctx.artifact_of(origin).filename,
                },
            }
        )
    return out


def candidates_list(db: Session, ctx: Context) -> dict:
    holdings = {
        h
        for c in ctx.baseline.candidates.values()
        for s in c.shared
        for h in (s.holding_a, s.holding_b)
    }
    refs = Refs(ctx, ctx.baseline, _load_items(db, ctx, holdings))
    candidates = [
        candidate_out(refs, candidate)
        for candidate in sorted(ctx.baseline.candidates.values(), key=lambda c: c.key)
    ]
    return {"candidates": candidates, **refs.tables()}


def decision_history(db: Session, workspace: Workspace) -> list[dict]:
    actors = {p.id: p for p in db.scalars(select(Principal))}
    rows: list[dict] = []
    for model, target in (
        (IdentityDecisionRow, "candidate_key"),
        (AssertionReview, "assertion_key"),
        (GroupingDecision, "link_key"),
    ):
        for row in db.scalars(select(model).where(model.workspace_id == workspace.id)):
            rows.append(
                {
                    "type": model.__tablename__,
                    "target": getattr(row, target),
                    "state": row.state,
                    "reason": row.reason,
                    "actor": actors[row.actor_id].handle if row.actor_id in actors else None,
                    "version": row.version,
                    "at": _iso(row.created_at),
                }
            )
    return sorted(rows, key=lambda r: (r["version"], r["type"], r["target"]))


def export_finding(
    db: Session, ctx: Context, principal: Principal, finding_key: str
) -> tuple[bytes, dict]:
    """Seal one finding, everything it was computed from, and how, into a package."""
    from app.config import get_settings
    from app.investigation import package

    finding = ctx.baseline.findings.get(finding_key)
    if finding is None:
        raise NotFound(finding_key)

    store = get_store()
    originals: dict[str, bytes] = {}
    for view in ctx.artifacts.values():
        try:
            originals[f"originals/{view.sha256}"] = store.get(view.sha256)
        except (IntegrityError, MissingOriginal) as exc:
            raise InvalidRequest(
                f"Refusing to export: original {view.filename} failed its integrity check ({exc})"
            ) from exc

    def as_json(value) -> bytes:
        return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False).encode("utf-8")

    files = {
        "finding.json": as_json(
            {
                "finding": finding_detail(db, ctx, ctx.baseline, finding),
                "sensitivity": sensitivity_out(ctx, ctx.baseline, finding),
                "reproducible": package.reproducible_view(ctx.baseline, finding),
            }
        ),
        "scenario.json": as_json(
            {
                "cases": list(ctx.snapshot.cases),
                "subjects": ctx.subjects,
                "scenario": ctx.baseline.scenario.to_dict(),
                "decisions": {
                    "identity": [
                        {
                            "candidate": d.candidate,
                            "a": d.a,
                            "b": d.b,
                            "state": d.state,
                            "evidence": list(d.evidence),
                        }
                        for d in ctx.snapshot.decisions
                    ],
                    "reviews": dict(sorted(ctx.snapshot.reviews.items())),
                    "groupings": dict(sorted(ctx.snapshot.groupings.items())),
                },
                "history": decision_history(db, ctx.workspace),
            }
        ),
        "artifacts.json": as_json(
            [
                {
                    "sha256": view.sha256,
                    "case": view.code,
                    "filename": view.filename,
                    "kind": view.kind,
                    "source_org": view.source_org,
                    "bytes": view.byte_size,
                }
                for view in sorted(ctx.artifacts.values(), key=lambda v: (v.code, v.filename))
            ]
        ),
        **originals,
    }
    manifest = {
        "finding": finding.key,
        "title": _finding_title(ctx, finding),
        "status": finding.status,
        "workspace": {
            "id": ctx.workspace.id,
            "name": ctx.workspace.name,
            "purpose": ctx.workspace.purpose,
            "decision_version": ctx.workspace.decision_version,
        },
        "cases": [
            {"code": code, "name": ctx.case_names.get(code, code)} for code in ctx.snapshot.cases
        ],
        "exported_by": principal.handle,
        "exported_at": package.exported_at(),
        "engine": E.ENGINE_VERSION,
        "extractor": EXTRACTOR_VERSION,
        "audit_head": audit.head(db),
        "originals_included": "every original in the workspace",
        "limits": [
            "Integrity shows this package is unchanged since it was signed, not that any "
            "source is true.",
            "Reproduction shows how the result follows from these originals and decisions; "
            "it does not validate the investigative hypothesis.",
            "Synthetic demonstration data.",
        ],
    }
    key = package.load_or_create_key(get_settings().signing_key_path)
    data, sealed = package.write_package(files, manifest, key)
    audit.record(
        db,
        principal.handle,
        "finding.exported",
        finding.key,
        {
            "workspace": ctx.workspace.id,
            "version": ctx.workspace.decision_version,
            "manifest_sha256": hashlib.sha256(package.canonical(sealed)).hexdigest(),
            "key_id": package.key_id(key.public_key()),
        },
    )
    db.commit()
    return data, sealed
