"""API smoke tests. These must pass from Phase 0 onward."""

from __future__ import annotations


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_create_and_list_case(client):
    created = client.post("/api/cases", json={"name": "Operation Test"})
    assert created.status_code == 201
    case_id = created.json()["id"]

    listed = client.get("/api/cases")
    assert listed.status_code == 200
    assert any(c["id"] == case_id for c in listed.json())


def test_get_missing_case_returns_404(client):
    assert client.get("/api/cases/99999").status_code == 404


def test_case_stats_start_empty(client, case):
    stats = client.get(f"/api/cases/{case.id}/stats")
    assert stats.status_code == 200
    body = stats.json()
    assert body["entities"] == 0
    assert body["open_alerts"] == 0


def test_empty_upload_is_rejected(client, case):
    response = client.post(
        f"/api/cases/{case.id}/documents",
        files={"file": ("empty.txt", b"", "text/plain")},
        data={"doc_type": "report"},
    )
    assert response.status_code == 422
