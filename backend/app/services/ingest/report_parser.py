"""Convert uploaded report bytes to plain text (PLAN.md section 5.1).

Phase 1. Consumed by services.ingest.pipeline.
"""

from __future__ import annotations

import io


class UnsupportedDocumentError(ValueError):
    """Raised when a file extension has no registered parser."""


def parse_to_text(filename: str, raw: bytes) -> str:
    """Dispatch on file extension and return extracted plain text.

    Note: PDF support is text-layer only. Scanned FIRs would need OCR, which is
    an explicit non-goal (PLAN.md section 10).
    """
    lower = filename.lower()

    if lower.endswith((".txt", ".md")):
        return raw.decode("utf-8", errors="replace")

    if lower.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)

    if lower.endswith(".docx"):
        import docx

        document = docx.Document(io.BytesIO(raw))
        return "\n\n".join(p.text for p in document.paragraphs)

    raise UnsupportedDocumentError(f"No parser registered for {filename!r}")
