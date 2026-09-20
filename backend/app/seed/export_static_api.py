"""Export the demo case as a static copy of the API for the hosted frontend preview.

Run:  uv run python -m app.seed.export_static_api

Seeds Operation Nightfall into a throwaway database, replays every read the UI
makes against the real API, and writes the responses to
frontend/public/static-api.json. A frontend built with `npm run build:static`
answers from that file, so the preview needs no backend and still shows exactly
what the backend returned.

The request list mirrors the frontend's calls (src/api/client.ts and the views
that use it). When a view starts asking for something new, add it here.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "static-api.json"

# The three scopes GraphExplorer.tsx offers: actors, +context, all.
GRAPH_SCOPES = [
    "PERSON,ORG",
    "PERSON,ORG,LOCATION,VEHICLE,DRUG,WEAPON",
    "PERSON,ORG,LOCATION,VEHICLE,DRUG,WEAPON,PHONE,BANK_ACCOUNT",
]

# GraphExplorer ranks the top 10 by its metric picker; the dashboard shows the top 5 brokers.
KEY_PLAYER_QUERIES = [
    ("betweenness", 10),
    ("degree", 10),
    ("pagerank", 10),
    ("betweenness", 5),
]

VULNERABILITY_TOP = 5


def request_key(path: str, params: dict[str, Any]) -> str:
    """Key a response the way staticKey() in client.ts looks it up: the path, then
    the query parameters sorted by name."""
    if not params:
        return path
    return path + "?" + "&".join(f"{name}={params[name]}" for name in sorted(params))


def capture() -> dict[str, Any]:
    """Seed the demo through the API and record every response the UI can ask for."""
    from fastapi.testclient import TestClient

    from app.db import engine
    from app.main import app

    responses: dict[str, Any] = {}

    try:
        with TestClient(app) as client:

            def get(path: str, **params: Any) -> Any:
                response = client.get(path, params=params)
                response.raise_for_status()
                body = response.json()
                responses[request_key(path, params)] = body
                return body

            seeded = client.post("/api/demo/reset")
            seeded.raise_for_status()
            base = f"/api/cases/{seeded.json()['id']}"

            get("/api/cases")
            get(f"{base}/stats")
            get(f"{base}/alerts")

            for document in get(f"{base}/documents"):
                get(f"{base}/documents/{document['id']}")
            for entity in get(f"{base}/entities"):
                get(f"{base}/entities/{entity['id']}")

            people: set[int] = set()
            for scope in GRAPH_SCOPES:
                graph = get(f"{base}/graph", entity_types=scope)
                people.update(
                    int(node["id"]) for node in graph["nodes"] if node["entity_type"] == "PERSON"
                )

            for metric, top in KEY_PLAYER_QUERIES:
                get(f"{base}/graph/metrics", metric=metric, top=top)
            get(f"{base}/graph/vulnerabilities", top=VULNERABILITY_TOP)

            # The Trace panel offers every person in the graph at either end.
            for source in sorted(people):
                for target in sorted(people - {source}):
                    get(f"{base}/graph/path", source=source, target=target)
    finally:
        # SQLite keeps the scratch file open, and Windows cannot delete it until released.
        engine.dispose()

    return responses


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the demo case as a static API copy.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as scratch:
        # Set before anything imports app.db, so the export neither touches nor
        # depends on the developer's own netintel.db.
        os.environ["DATABASE_URL"] = f"sqlite:///{Path(scratch, 'static-api.db').as_posix()}"
        responses = capture()

    ordered = {key: responses[key] for key in sorted(responses)}
    text = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(f"Wrote {len(ordered)} responses ({len(text.encode()) // 1024} KB) to {args.out}")


if __name__ == "__main__":
    main()
