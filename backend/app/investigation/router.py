"""HTTP surface of the investigation layer. Additive to the existing case routes.

Mounted by app.main. Every workspace route re-resolves the caller's live grants
before loading anything, and refusals never say whether the thing refused
exists (investigation.access).

The caller names themselves in the X-Principal header. That is a demo stand-in
for authentication, and the API says so rather than pretending otherwise.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models as core
from app.db import get_db
from app.investigation import access, audit, service
from app.investigation.models import CaseProfile, Principal, ScenarioRun

router = APIRouter(prefix="/api", tags=["investigation"])


# --- Plumbing ------------------------------------------------------------------------


def current_principal(
    x_principal: str | None = Header(None, alias="X-Principal"),
    db: Session = Depends(get_db),
) -> Principal:
    try:
        return access.resolve_principal(db, x_principal)
    except access.NotAuthenticated as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _workspace(db: Session, principal: Principal, workspace_id: int):
    try:
        workspace = access.require_workspace(db, principal, workspace_id)
    except access.AccessDenied as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return workspace, service.context(db, workspace, principal)


def _fail(exc: Exception):
    if isinstance(exc, service.VersionConflict):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, service.NotFound):
        raise HTTPException(status_code=404, detail="Not found in this workspace.") from exc
    if isinstance(exc, service.InvalidRequest | access.AccessDenied):
        status = 404 if isinstance(exc, access.AccessDenied) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    raise exc


def _workspace_out(db: Session, workspace, ctx: service.Context) -> dict:
    profiles = {
        p.case_id: p
        for p in db.scalars(select(CaseProfile).where(CaseProfile.case_id.in_(workspace.case_ids)))
    }
    cases = {
        c.id: c for c in db.scalars(select(core.Case).where(core.Case.id.in_(workspace.case_ids)))
    }
    baseline = ctx.baseline
    return {
        "id": workspace.id,
        "name": workspace.name,
        "purpose": workspace.purpose,
        "version": workspace.decision_version,
        "created_at": service._iso(workspace.created_at),
        "cases": [
            {
                "id": case_id,
                "code": ctx.codes[case_id],
                "name": cases[case_id].name if case_id in cases else ctx.codes[case_id],
                "agency": profiles[case_id].agency if case_id in profiles else None,
            }
            for case_id in workspace.case_ids
        ],
        "counts": {
            "originals": len(ctx.artifacts),
            "statements": len(ctx.snapshot.assertions),
            "people": len(baseline.persons),
            "relationships": len(baseline.edges),
            "source_links": len(ctx.snapshot.links),
            "identity_candidates": len(baseline.candidates),
            "conflicts": len(baseline.conflicts),
            "findings": len(baseline.findings),
        },
        "demo_identity": True,
    }


# --- Who is asking -----------------------------------------------------------------------


@router.get("/me")
def me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """The caller and the cases they may compare. Nothing about anyone else's."""
    grants = access.active_grants(db, principal)
    cases = {
        c.id: c
        for c in db.scalars(select(core.Case).where(core.Case.id.in_([g.case_id for g in grants])))
    }
    return {
        "handle": principal.handle,
        "name": principal.display_name,
        "role": principal.role,
        "grants": [
            {
                "case_id": g.case_id,
                "code": service.case_code(db, g.case_id),
                "case_name": cases[g.case_id].name if g.case_id in cases else None,
                "purpose": g.purpose,
                "expires_at": service._iso(g.expires_at),
            }
            for g in sorted(grants, key=lambda g: (g.purpose, g.case_id))
        ],
        "demo_identity": True,
    }


@router.get("/principals")
def principals(db: Session = Depends(get_db)):
    """Demo only: the identities a presenter can switch between."""
    return [
        {"handle": p.handle, "name": p.display_name, "role": p.role}
        for p in db.scalars(select(Principal).order_by(Principal.id))
    ]


# --- Workspaces ----------------------------------------------------------------------------


class WorkspaceCreate(BaseModel):
    case_ids: list[int] = Field(min_length=2)
    purpose: str = Field(min_length=3, max_length=300)
    name: str = Field(default="", max_length=200)


@router.get("/workspaces")
def list_workspaces(
    principal: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    return [
        {
            "id": w.id,
            "name": w.name,
            "purpose": w.purpose,
            "version": w.decision_version,
            "case_count": len(w.case_ids or []),
        }
        for w in service.list_workspaces(db, principal)
    ]


@router.post("/workspaces", status_code=201)
def create_workspace(
    payload: WorkspaceCreate,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    try:
        workspace = service.create_workspace(
            db, principal, case_ids=payload.case_ids, purpose=payload.purpose, name=payload.name
        )
    except (service.InvalidRequest, access.AccessDenied) as exc:
        _fail(exc)
    return _workspace_out(db, workspace, service.context(db, workspace, principal))


@router.get("/workspaces/{workspace_id}")
def get_workspace(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, ctx = _workspace(db, principal, workspace_id)
    return _workspace_out(db, workspace, ctx)


@router.get("/workspaces/{workspace_id}/findings")
def list_findings(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """The review queue: leads first, since they are what needs a person."""
    _, ctx = _workspace(db, principal, workspace_id)
    tasks = service._plan(ctx)
    rows = []
    for finding in ctx.baseline.findings.values():
        summary = service.finding_summary(ctx, ctx.baseline, finding)
        top = next((t for t in tasks if finding.key in t.affected), None)
        summary["next_task"] = (
            {"key": top.key, "title": top.title, "kind": top.kind} if top else None
        )
        rows.append(summary)
    order = {"lead": 0, "supported": 1}
    rows.sort(key=lambda r: (order.get(r["status"], 2), r["distance"], r["title"]))
    return rows


@router.get("/workspaces/{workspace_id}/findings/{finding_key}")
def get_finding(
    workspace_id: int,
    finding_key: str,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    finding = ctx.baseline.findings.get(finding_key)
    if finding is None:
        raise HTTPException(status_code=404, detail="Not found in this workspace.")
    detail = service.finding_detail(db, ctx, ctx.baseline, finding)
    detail["tasks"] = service.tasks_out(ctx, finding_key)
    affecting = [t for t in detail["tasks"] if finding_key in {a["key"] for a in t["affected"]}]
    detail["next_task"] = (
        {"key": affecting[0]["key"], "title": affecting[0]["title"], "kind": affecting[0]["kind"]}
        if affecting
        else None
    )
    detail["history"] = [
        {
            "version": h["version"],
            "reason": h["reason"],
            "actor": h["actor"],
            "at": h["at"],
            "status": h["statuses"].get(finding_key, "unsupported"),
        }
        for h in service.history(db, ctx)
    ]
    return detail


@router.get("/workspaces/{workspace_id}/findings/{finding_key}/sensitivity")
def finding_sensitivity(
    workspace_id: int,
    finding_key: str,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    finding = ctx.baseline.findings.get(finding_key)
    if finding is None:
        raise HTTPException(status_code=404, detail="Not found in this workspace.")
    return service.sensitivity_out(ctx, ctx.baseline, finding)


@router.post("/workspaces/{workspace_id}/findings/{finding_key}/exports")
def export_finding(
    workspace_id: int,
    finding_key: str,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """A signed package. Access is re-checked here, at the moment of export."""
    _, ctx = _workspace(db, principal, workspace_id)
    try:
        data, manifest = service.export_finding(db, ctx, principal, finding_key)
    except (service.NotFound, service.InvalidRequest) as exc:
        _fail(exc)
    filename = f"netintel-{finding_key}-v{manifest['workspace']['decision_version']}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/workspaces/{workspace_id}/tasks")
def verification_tasks(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.tasks_out(ctx)


@router.get("/workspaces/{workspace_id}/contrast")
def contrast(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.contrast(ctx)


@router.get("/workspaces/{workspace_id}/families")
def families(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.families_out(ctx)


@router.get("/workspaces/{workspace_id}/lineage")
def lineage_links(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.lineage_out(ctx)


@router.get("/workspaces/{workspace_id}/candidates")
def candidates(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.candidates_list(db, ctx)


@router.get("/workspaces/{workspace_id}/artifacts")
def artifacts(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    return service.artifacts_out(ctx)


@router.get("/workspaces/{workspace_id}/artifacts/{artifact_id}")
def artifact(
    workspace_id: int,
    artifact_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _, ctx = _workspace(db, principal, workspace_id)
    try:
        return service.artifact_detail(db, ctx, artifact_id)
    except service.NotFound as exc:
        _fail(exc)


@router.get("/workspaces/{workspace_id}/history")
def workspace_history(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, ctx = _workspace(db, principal, workspace_id)
    return {
        "snapshots": service.history(db, ctx),
        "decisions": service.decision_history(db, workspace),
    }


# --- Decisions -----------------------------------------------------------------------------


class IdentityDecisionIn(BaseModel):
    candidate: str
    state: Literal["accepted", "rejected", "deferred"]
    evidence: list[str] = []
    reason: str = Field(min_length=3, max_length=2000)
    expected_version: int


class AssertionReviewIn(BaseModel):
    assertion: str
    state: Literal["accepted", "disputed", "rejected"]
    reason: str = Field(min_length=3, max_length=2000)
    expected_version: int
    whole_passage: bool = True


class GroupingDecisionIn(BaseModel):
    link: str
    state: Literal["accepted", "rejected"]
    reason: str = Field(min_length=3, max_length=2000)
    expected_version: int


@router.post("/workspaces/{workspace_id}/decisions/identity")
def decide_identity(
    workspace_id: int,
    payload: IdentityDecisionIn,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    try:
        version = service.decide_identity(
            db,
            workspace,
            principal,
            candidate=payload.candidate,
            state=payload.state,
            evidence=payload.evidence,
            reason=payload.reason,
            expected_version=payload.expected_version,
        )
    except (service.VersionConflict, service.NotFound, service.InvalidRequest) as exc:
        _fail(exc)
    return {"version": version}


@router.post("/workspaces/{workspace_id}/decisions/assertion")
def review_assertion(
    workspace_id: int,
    payload: AssertionReviewIn,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    try:
        version = service.review_assertion(
            db,
            workspace,
            principal,
            assertion=payload.assertion,
            state=payload.state,
            reason=payload.reason,
            expected_version=payload.expected_version,
            whole_passage=payload.whole_passage,
        )
    except (service.VersionConflict, service.NotFound, service.InvalidRequest) as exc:
        _fail(exc)
    return {"version": version}


@router.post("/workspaces/{workspace_id}/decisions/grouping")
def decide_grouping(
    workspace_id: int,
    payload: GroupingDecisionIn,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    try:
        version = service.decide_grouping(
            db,
            workspace,
            principal,
            link=payload.link,
            state=payload.state,
            reason=payload.reason,
            expected_version=payload.expected_version,
        )
    except (service.VersionConflict, service.NotFound, service.InvalidRequest) as exc:
        _fail(exc)
    return {"version": version}


class TaskOutcomeIn(BaseModel):
    outcome: str
    reason: str = Field(min_length=3, max_length=2000)
    expected_version: int


@router.post("/workspaces/{workspace_id}/tasks/{task_key}/record")
def record_task_outcome(
    workspace_id: int,
    task_key: str,
    payload: TaskOutcomeIn,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Record what checking a task found. Every decision it implies lands as one version."""
    workspace, _ = _workspace(db, principal, workspace_id)
    try:
        version = service.record_outcome(
            db,
            workspace,
            principal,
            task=task_key,
            outcome=payload.outcome,
            reason=payload.reason,
            expected_version=payload.expected_version,
        )
    except (service.VersionConflict, service.NotFound, service.InvalidRequest) as exc:
        _fail(exc)
    return {"version": version}


# --- Scenarios -----------------------------------------------------------------------------


class ScenarioIn(BaseModel):
    name: str = Field(default="Scenario", max_length=200)
    definition: dict = {}
    idempotency_key: str | None = Field(default=None, max_length=80)


@router.post("/workspaces/{workspace_id}/scenarios", status_code=201)
def create_scenario(
    workspace_id: int,
    payload: ScenarioIn,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    run = service.run_scenario(
        db,
        workspace,
        principal,
        name=payload.name,
        definition=payload.definition,
        idempotency_key=payload.idempotency_key,
    )
    return service.scenario_out(run, workspace)


@router.get("/workspaces/{workspace_id}/scenarios")
def list_scenarios(
    workspace_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    runs = db.scalars(
        select(ScenarioRun)
        .where(ScenarioRun.workspace_id == workspace.id)
        .order_by(ScenarioRun.id.desc())
        .limit(20)
    ).all()
    return [service.scenario_out(run, workspace) for run in runs]


@router.get("/workspaces/{workspace_id}/scenarios/{scenario_id}")
def get_scenario(
    workspace_id: int,
    scenario_id: int,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    workspace, _ = _workspace(db, principal, workspace_id)
    run = db.get(ScenarioRun, scenario_id)
    if run is None or run.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="Not found in this workspace.")
    return service.scenario_out(run, workspace)


# --- Receipts and audit --------------------------------------------------------------------


@router.get("/receipts/public-key", response_class=Response)
def public_key():
    """This server's verification key. Distribute it separately from packages."""
    from app.config import get_settings
    from app.investigation import package

    key = package.load_or_create_key(get_settings().signing_key_path)
    return Response(content=package.public_key_pem(key), media_type="application/x-pem-file")


@router.post("/receipts/verify")
async def verify_upload(file: UploadFile = File(...), reproduce: bool = Form(False)):
    """Convenience check against this server's own key. The independent route is
    the command-line verifier with a key obtained separately."""
    from app.config import get_settings
    from app.investigation import package

    key = package.load_or_create_key(get_settings().signing_key_path)
    data = await file.read()
    return package.verify_package(data, package.public_key_pem(key), reproduce=reproduce).as_dict()


@router.get("/audit/verify")
def audit_chain(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return audit.verify_chain(db)


# --- Demo ------------------------------------------------------------------------------------


@router.post("/demo/broken-mirror/reset")
def reset_broken_mirror(db: Session = Depends(get_db)):
    """Reload Operation Broken Mirror: three synthetic case files, grants, a workspace."""
    from app.seed.load_broken_mirror import reset_and_load

    workspace = reset_and_load(db)
    return {"workspace_id": workspace.id, "principal": "inspector.rao"}
