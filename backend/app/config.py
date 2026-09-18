"""Application settings, loaded from environment / .env file.

Imported by app.main, app.db, and app.services.extraction.llm_extractor.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "NetIntel API"
    debug: bool = True

    # Persistence
    database_url: str = f"sqlite:///{BASE_DIR / 'netintel.db'}"

    # CORS — the Vite dev server
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # NLP
    spacy_model: str = "en_core_web_lg"

    # Optional LLM-assisted relation extraction (PLAN.md 5.3).
    # Falls back to rule-based extraction when disabled or on any API failure.
    use_llm_extraction: bool = False
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"

    # Anomaly detection thresholds (PLAN.md 5.6)
    txn_spike_zscore: float = 3.0
    structuring_threshold: float = 50_000.0
    structuring_window_days: int = 7
    structuring_min_count: int = 3

    # Graph rendering guard (PLAN.md 9)
    max_graph_nodes: int = 500

    # Investigation layer (MASTER_PLAN.md). Originals are kept byte for byte in a
    # content-addressed store before anything parses them; the signing key signs
    # exported finding packages. Both paths are runtime state, not source.
    evidence_store_dir: Path = BASE_DIR / "evidence_store"
    signing_key_path: Path = BASE_DIR / "keys" / "receipt_ed25519.pem"


@lru_cache
def get_settings() -> Settings:
    return Settings()
