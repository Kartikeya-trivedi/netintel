"""Content-addressed store for original evidence bytes.

Consumed by investigation.service, routers.ingest and investigation.package.

Originals are written before any parser touches them and are never rewritten.
The address is the sha256 of the bytes, so a stored file can always be checked
against its own name, and a later re-extraction reads exactly what was
received. Identical uploads share one file on disk and nothing else: which case
holds an original is recorded in the database and never inferred from here.

A hash alone cannot bring a source back. That is the gap this closes: the
upload path used to hash an upload and hand the bytes to a background task,
leaving nothing to re-read if extraction was ever questioned.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

_DIGEST = re.compile(r"^[0-9a-f]{64}$")

INTACT = "intact"
MISSING = "missing"
ALTERED = "altered"


class IntegrityError(RuntimeError):
    """A stored original no longer matches the digest it was stored under."""


class MissingOriginal(FileNotFoundError):
    """No original is stored under this digest."""


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


class EvidenceStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path_for(self, sha256: str) -> Path:
        if not _DIGEST.match(sha256):
            raise ValueError(f"Not a sha256 digest: {sha256!r}")
        return self.root / sha256[:2] / sha256

    def put(self, raw: bytes) -> str:
        """Store bytes and return their digest. Idempotent for identical bytes.

        A copy already on disk is checked, not trusted: if it no longer matches
        its name, that is an integrity incident to report, and overwriting it
        would destroy the evidence of it.
        """
        sha = digest(raw)
        target = self.path_for(sha)
        if target.exists():
            if digest(target.read_bytes()) != sha:
                raise IntegrityError(f"Stored original {sha[:12]} does not match its digest")
            return sha

        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".incoming-")
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return sha

    def get(self, sha256: str) -> bytes:
        """Read an original back, refusing it if it has changed on disk."""
        path = self.path_for(sha256)
        if not path.exists():
            raise MissingOriginal(f"No original stored for {sha256[:12]}")
        raw = path.read_bytes()
        if digest(raw) != sha256:
            raise IntegrityError(f"Stored original {sha256[:12]} does not match its digest")
        return raw

    def verify(self, sha256: str) -> str:
        """intact | missing | altered -- never raises for a bad file."""
        path = self.path_for(sha256)
        if not path.exists():
            return MISSING
        return INTACT if digest(path.read_bytes()) == sha256 else ALTERED


@lru_cache
def _store_at(root: str) -> EvidenceStore:
    return EvidenceStore(Path(root))


def get_store() -> EvidenceStore:
    return _store_at(str(get_settings().evidence_store_dir))
