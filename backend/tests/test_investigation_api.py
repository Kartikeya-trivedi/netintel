"""The investigation API: access before anything else, versioned decisions,
honest scenarios, and packages that verify away from the server.

One in-memory database per module, loaded once with Operation Broken Mirror.
Tests that decide things open their own workspace, so no test depends on
another's decisions.
"""

from __future__ import annotations

import hashlib
import io
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.investigation import audit, package
from app.investigation.models import AuditEvent, CaseGrant, EvidenceArtifact, Principal
from app.investigation.store import get_store
from app.investigation.verify import main as verify_cli
from app.main import app
from app.seed.load_broken_mirror import PURPOSE, reset_and_load

INSPECTOR = {"X-Principal": "inspector.rao"}
ANALYST = {"X-Principal": "analyst.das"}


@pytest.fixture(scope="module")
def env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    workspace = reset_and_load(session, legacy=False)
    case_ids = list(workspace.case_ids)
    app.dependency_overrides[get_db] = lambda: session
    with TestClient(app) as client:
        yield client, session, workspace.id, case_ids
    app.dependency_overrides.clear()
    session.close()


@pytest.fixture
def fresh(env):
    """A workspace of the inspector's own, for tests that record decisions."""
    client, session, _, case_ids = env
    response = client.post(
        "/api/workspaces",
        headers=INSPECTOR,
        json={"case_ids": case_ids, "purpose": PURPOSE, "name": "scratch"},
    )
    assert response.status_code == 201, response.text
    return client, session, response.json()["id"]


def lead_of(client, workspace_id):
    findings = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
    lead = next(f for f in findings if f["status"] == "lead")
    return lead, client.get(
        f"/api/workspaces/{workspace_id}/findings/{lead['key']}", headers=INSPECTOR
    ).json()


def tip_evidence(detail) -> str:
    return next(
        key
        for key, item in detail["evidence"].items()
        if item["document"]["filename"].startswith("BM3_informant") and item["predicate"] == "HOLDS"
    )


# --- Access -----------------------------------------------------------------------------------


def test_requests_must_name_a_known_principal(env):
    client, _, workspace_id, _ = env
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/workspaces", headers={"X-Principal": "nobody"}).status_code == 401


def test_an_unauthorised_case_looks_exactly_like_a_missing_one(env):
    client, _, workspace_id, case_ids = env
    purpose = "Review: loan-app complaints"
    refused = client.post(
        "/api/workspaces", headers=ANALYST, json={"case_ids": case_ids[:2], "purpose": purpose}
    )
    missing = client.post(
        "/api/workspaces",
        headers=ANALYST,
        json={"case_ids": [case_ids[0], 999_999], "purpose": purpose},
    )
    assert refused.status_code == missing.status_code == 404
    assert refused.json() == missing.json()

    theirs = client.get(f"/api/workspaces/{workspace_id}", headers=ANALYST)
    nowhere = client.get("/api/workspaces/999999", headers=ANALYST)
    assert theirs.status_code == nowhere.status_code == 404
    assert theirs.json() == nowhere.json()


def test_the_analyst_sees_only_their_own_grant(env):
    client = env[0]
    me = client.get("/api/me", headers=ANALYST).json()
    assert [(g["code"], g["purpose"]) for g in me["grants"]] == [
        ("BM-1", "Review: loan-app complaints")
    ]
    assert client.get("/api/workspaces", headers=ANALYST).json() == []


def test_a_grant_covers_its_purpose_and_nothing_wider(env):
    client, _, _, case_ids = env
    response = client.post(
        "/api/workspaces",
        headers=INSPECTOR,
        json={"case_ids": case_ids, "purpose": "Something else"},
    )
    assert response.status_code == 404


def test_revocation_and_expiry_close_a_workspace_at_once(env):
    client, session, _, case_ids = env
    officer = Principal(handle="temp.officer", display_name="Temp", role="investigator")
    session.add(officer)
    session.flush()
    grants = [
        CaseGrant(principal_id=officer.id, case_id=c, purpose=PURPOSE, granted_by="test")
        for c in case_ids
    ]
    session.add_all(grants)
    session.commit()
    headers = {"X-Principal": "temp.officer"}
    created = client.post(
        "/api/workspaces", headers=headers, json={"case_ids": case_ids, "purpose": PURPOSE}
    )
    workspace_id = created.json()["id"]
    assert client.get(f"/api/workspaces/{workspace_id}", headers=headers).status_code == 200

    grants[0].expires_at = datetime.now(UTC) - timedelta(minutes=1)
    session.commit()
    assert client.get(f"/api/workspaces/{workspace_id}", headers=headers).status_code == 404

    grants[0].expires_at = None
    grants[1].revoked_at = datetime.now(UTC)
    session.commit()
    assert client.get(f"/api/workspaces/{workspace_id}", headers=headers).status_code == 404


# --- Reading ----------------------------------------------------------------------------------


def test_queue_puts_the_lead_first_and_details_resolve(env):
    client, _, workspace_id, _ = env
    findings = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
    assert findings[0]["status"] == "lead"
    assert "Sameer Khan" in findings[0]["title"] and "Pappu Shinde" in findings[0]["title"]
    assert findings[0]["assumptions"]["provisional_identities"] == 1

    _, detail = lead_of(client, workspace_id)
    for explanation in detail["explanations"]:
        assert set(explanation["nodes"]) <= set(detail["people"])
        assert set(explanation["families"]) <= set(detail["families"])
        for step in explanation["steps"]:
            for edge in step["edges"]:
                for derivation in edge["derivations"]:
                    assert set(derivation["evidence"]) <= set(detail["evidence"])
    (conflict,) = [c for c in detail["contrary"] if c["kind"] == "attribution"]
    assert conflict["identifier"] == "9867012345"


def test_tasks_rank_by_grounds_then_by_what_they_would_change(env):
    client, _, workspace_id, _ = env
    tasks = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=INSPECTOR).json()
    order = {"contradiction": 0, "unreviewed assumption": 1, "single-source dependency": 2}
    keys = [(order[t["grounds"]], -t["status_changes"]) for t in tasks]
    assert keys == sorted(keys)

    # The contradiction comes first: the tip and the subscriber record disagree.
    first = tasks[0]
    assert first["kind"] == "attribution" and first["grounds"] == "contradiction"
    outcome = next(o for o in first["outcomes"] if o["label"].startswith("Anil Borade"))
    assert [c["to"] for c in outcome["changes"]] == ["unsupported"]


def test_contrast_shows_the_naive_false_bridge(env):
    client, _, workspace_id, _ = env
    rows = client.get(f"/api/workspaces/{workspace_id}/contrast", headers=INSPECTOR).json()[
        "findings"
    ]
    row = next(r for r in rows if (r["a"], r["b"]) == ("Sameer Khan", "Pappu Shinde"))
    assert row["naive_status"] == "supported"
    assert row["ours"]["status"] == "lead"


# --- Deciding ---------------------------------------------------------------------------------


def test_decisions_are_versioned_and_earlier_readings_are_kept(fresh):
    client, _, workspace_id = fresh
    lead, detail = lead_of(client, workspace_id)
    body = {
        "assertion": tip_evidence(detail),
        "state": "disputed",
        "reason": "Operator history shows re-issue to Anil Borade on 2026-04-20",
        "expected_version": 0,
    }
    first = client.post(
        f"/api/workspaces/{workspace_id}/decisions/assertion", headers=INSPECTOR, json=body
    )
    assert first.status_code == 200 and first.json() == {"version": 1}
    stale = client.post(
        f"/api/workspaces/{workspace_id}/decisions/assertion", headers=INSPECTOR, json=body
    )
    assert stale.status_code == 409

    remaining = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
    assert lead["key"] not in {f["key"] for f in remaining}

    history = client.get(f"/api/workspaces/{workspace_id}/history", headers=INSPECTOR).json()
    statuses = [
        (s["version"], s["statuses"].get(lead["key"], "unsupported")) for s in history["snapshots"]
    ]
    assert statuses == [(0, "lead"), (1, "unsupported")]
    assert history["decisions"] and all(d["state"] == "disputed" for d in history["decisions"])


def test_recording_what_a_check_found_is_one_versioned_decision(fresh):
    client, session, workspace_id = fresh
    lead, _ = lead_of(client, workspace_id)
    tasks = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=INSPECTOR).json()
    who = next(t for t in tasks if t["kind"] == "attribution")
    anil = next(o for o in who["outcomes"] if o["label"].startswith("Anil Borade"))

    url = f"/api/workspaces/{workspace_id}/tasks/{who['key']}/record"
    body = {
        "outcome": anil["key"],
        "reason": "Operator history: re-issued to Anil Borade on 2026-04-20",
        "expected_version": 0,
    }
    recorded = client.post(url, headers=INSPECTOR, json=body)
    assert recorded.status_code == 200 and recorded.json() == {"version": 1}
    assert client.post(url, headers=INSPECTOR, json=body).status_code == 409

    remaining = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
    assert lead["key"] not in {f["key"] for f in remaining}

    history = client.get(f"/api/workspaces/{workspace_id}/history", headers=INSPECTOR).json()
    assert [s["version"] for s in history["snapshots"]] == [0, 1]
    assert "Anil Borade" in history["snapshots"][1]["reason"]
    states = {(d["state"], d["version"]) for d in history["decisions"]}
    assert states == {("disputed", 1), ("accepted", 1)}

    event = session.scalars(select(AuditEvent).order_by(AuditEvent.id.desc())).first()
    assert event.action == "task.recorded" and event.target == who["key"]


def test_an_inconclusive_identity_check_is_recorded_as_deferred(fresh):
    client, _, workspace_id = fresh
    tasks = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=INSPECTOR).json()
    identity = next(t for t in tasks if t["kind"] == "identity")
    response = client.post(
        f"/api/workspaces/{workspace_id}/tasks/{identity['key']}/record",
        headers=INSPECTOR,
        json={"outcome": "inconclusive", "reason": "Records requested", "expected_version": 0},
    )
    assert response.status_code == 200
    history = client.get(f"/api/workspaces/{workspace_id}/history", headers=INSPECTOR).json()
    assert [d["state"] for d in history["decisions"]] == ["deferred"]


def test_accepting_an_identity_must_cite_evidence(fresh):
    client, _, workspace_id = fresh
    lead, detail = lead_of(client, workspace_id)
    (candidate,) = detail["candidates"]
    url = f"/api/workspaces/{workspace_id}/decisions/identity"
    bare = {
        "candidate": candidate["key"],
        "state": "accepted",
        "reason": "Same name",
        "expected_version": 0,
    }
    assert client.post(url, headers=INSPECTOR, json=bare).status_code == 422

    cited = candidate["shared"][0]["evidence"][:1]
    accepted = client.post(url, headers=INSPECTOR, json={**bare, "evidence": cited})
    assert accepted.status_code == 200
    after = client.get(
        f"/api/workspaces/{workspace_id}/findings/{lead['key']}", headers=INSPECTOR
    ).json()
    assert after["status"] == "supported"


def test_rejecting_a_copy_grouping_counts_the_copy_as_its_own_origin(fresh):
    client, _, workspace_id = fresh
    lead, detail = lead_of(client, workspace_id)
    before = detail["explanations"][0]["counts"]["origins"]
    links = client.get(f"/api/workspaces/{workspace_id}/lineage", headers=INSPECTOR).json()
    diary = [link for link in links if link["basis"] == "near_verbatim"]
    assert diary
    version = 0
    for link in diary:
        response = client.post(
            f"/api/workspaces/{workspace_id}/decisions/grouping",
            headers=INSPECTOR,
            json={
                "link": link["key"],
                "state": "rejected",
                "reason": "Diary adds its own entry",
                "expected_version": version,
            },
        )
        assert response.status_code == 200
        version = response.json()["version"]
    after = client.get(
        f"/api/workspaces/{workspace_id}/findings/{lead['key']}", headers=INSPECTOR
    ).json()
    assert after["explanations"][0]["counts"]["origins"] == before + 1


# --- Challenging ------------------------------------------------------------------------------


def test_a_scenario_reports_what_changed_and_fails_honestly(env):
    client, _, workspace_id, _ = env
    families = client.get(f"/api/workspaces/{workspace_id}/families", headers=INSPECTOR).json()
    tip = next(f for f in families if f["origin"].startswith("BM3_informant"))
    assert len(tip["documents"]) == 3

    url = f"/api/workspaces/{workspace_id}/scenarios"
    run = client.post(
        url,
        headers=INSPECTOR,
        json={"name": "no tip", "definition": {"exclude_families": [tip["key"]]}},
    )
    result = run.json()
    assert result["status"] == "complete"
    changed = [(r["before"], r["after"]) for r in result["result"]["findings"] if r["changed"]]
    assert changed == [("lead", "unsupported")]

    bad = client.post(
        url, headers=INSPECTOR, json={"definition": {"exclude_families": ["sf-nonexistent"]}}
    ).json()
    assert bad["status"] == "failed" and bad["result"] is None and "Unknown" in bad["error"]

    body = {"name": "again", "definition": {"claim_window_days": 1}, "idempotency_key": "k-1"}
    first = client.post(url, headers=INSPECTOR, json=body).json()
    second = client.post(url, headers=INSPECTOR, json=body).json()
    assert first["id"] == second["id"]


# --- Exporting --------------------------------------------------------------------------------


def _export(client, workspace_id) -> bytes:
    findings = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
    supported = next(f for f in findings if f["status"] == "supported")
    response = client.post(
        f"/api/workspaces/{workspace_id}/findings/{supported['key']}/exports", headers=INSPECTOR
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    return response.content


def test_a_package_verifies_and_reproduces_away_from_the_server(env, tmp_path):
    client, _, workspace_id, _ = env
    data = _export(client, workspace_id)
    public = client.get("/api/receipts/public-key").content

    report = package.verify_package(data, public, reproduce=True)
    assert (report.integrity, report.reproduction) == ("verified", "reproduced")

    (tmp_path / "p.zip").write_bytes(data)
    (tmp_path / "k.pem").write_bytes(public)
    assert (
        verify_cli(
            [str(tmp_path / "p.zip"), "--public-key", str(tmp_path / "k.pem"), "--reproduce"]
        )
        == 0
    )
    # Without a trusted key the answer is "unchecked", which never passes.
    assert verify_cli([str(tmp_path / "p.zip")]) == 1


def test_an_edited_package_fails_verification(env, tmp_path):
    client, _, workspace_id, _ = env
    data = _export(client, workspace_id)
    public = client.get("/api/receipts/public-key").content

    source = zipfile.ZipFile(io.BytesIO(data))
    edited = io.BytesIO()
    with zipfile.ZipFile(edited, "w") as target:
        for entry in source.infolist():
            content = source.read(entry.filename)
            if entry.filename.startswith("originals/") and b"Accused:" in content:
                content = content.replace(b"Accused:", b"Acquitted:", 1)
            target.writestr(entry, content)
    report = package.verify_package(edited.getvalue(), public, reproduce=True)
    assert report.integrity == "failed" and report.reproduction == "not possible"
    assert any(c["ok"] is False and c["check"].startswith("file:originals/") for c in report.checks)


def test_a_package_checked_against_another_key_fails(env):
    client, _, workspace_id, _ = env
    data = _export(client, workspace_id)
    stranger = package.public_key_pem(package.Ed25519PrivateKey.generate())
    assert package.verify_package(data, stranger).integrity == "failed"
    assert package.verify_package(data, None).integrity == "unchecked"


def test_export_refuses_an_altered_original(env):
    client, session, workspace_id, _ = env
    artifact = session.scalars(select(EvidenceArtifact)).first()
    path = get_store().path_for(artifact.sha256)
    original = path.read_bytes()
    try:
        path.write_bytes(original + b"tampered")
        listed = client.get(f"/api/workspaces/{workspace_id}/artifacts", headers=INSPECTOR).json()
        assert next(a for a in listed if a["id"] == artifact.id)["integrity"] == "altered"
        findings = client.get(f"/api/workspaces/{workspace_id}/findings", headers=INSPECTOR).json()
        response = client.post(
            f"/api/workspaces/{workspace_id}/findings/{findings[0]['key']}/exports",
            headers=INSPECTOR,
        )
        assert response.status_code == 422
        assert "integrity" in response.json()["detail"]
    finally:
        path.write_bytes(original)


def test_upload_preserves_the_original_before_parsing(env):
    client, session, _, case_ids = env
    raw = b"Accused: Test Person\n\nTest Person met Other Person.\n"
    response = client.post(
        f"/api/cases/{case_ids[0]}/documents",
        files={"file": ("note.txt", raw, "text/plain")},
        data={"doc_type": "report"},
    )
    assert response.status_code == 202
    sha = hashlib.sha256(raw).hexdigest()
    stored = session.scalar(select(EvidenceArtifact).where(EvidenceArtifact.sha256 == sha))
    assert stored is not None and stored.document_id == response.json()["id"]
    assert get_store().get(sha) == raw


def test_the_audit_chain_holds_and_notices_an_edit(env):
    client, session, _, _ = env
    assert client.get("/api/audit/verify", headers=INSPECTOR).json()["intact"] is True
    event = session.scalars(select(AuditEvent).order_by(AuditEvent.id)).first()
    kept = dict(event.detail)
    try:
        event.detail = {**kept, "edited": True}
        session.commit()
        broken = audit.verify_chain(session)
        assert broken["intact"] is False and broken["broken_at"] == event.id
    finally:
        event.detail = kept
        session.commit()
    assert audit.verify_chain(session)["intact"] is True
