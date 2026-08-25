"""FastAPI application entrypoint.

Run locally:  uv run uvicorn app.main:app --reload
OpenAPI docs: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import alerts, cases, demo, entities, graph, ingest, search

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "AI-powered criminal network analysis and intelligence platform. "
        "For authorized law-enforcement use. Demo data is entirely synthetic."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cases.router)
app.include_router(ingest.router)
app.include_router(entities.router)
app.include_router(graph.router)
app.include_router(alerts.router)
app.include_router(search.router)
app.include_router(demo.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name, "version": "0.1.0"}
