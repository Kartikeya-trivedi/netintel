"""Optional LLM-assisted extraction, behind the USE_LLM_EXTRACTION flag.

Phase 2 stretch goal (PLAN.md section 5.3). This layer only ever ADDS to the
rule-based output. Any failure -- no API key, rate limit, malformed JSON -- is
swallowed and the caller keeps the deterministic results, so a demo never dies
because a network call did.
"""

from __future__ import annotations

import json
import logging

from app.config import get_settings

logger = logging.getLogger(__name__)

EXTRACTION_SYSTEM_PROMPT = """You extract a knowledge graph from a police report.
Return ONLY valid JSON matching this schema:
{
  "entities": [
    {"text": str, "type": "PERSON|ORG|LOCATION|PHONE|BANK_ACCOUNT|VEHICLE|WEAPON|DRUG"}
  ],
  "relations": [
    {"source": str, "target": str, "snippet": str,
     "type": "ASSOCIATES_WITH|TRANSACTED_WITH|CALLED|LOCATED_AT|MEMBER_OF|OWNS"}
  ]
}
Use exact surface strings from the text. Do not infer facts the text does not state."""


def extract_with_llm(text: str) -> dict | None:
    """Return {"entities": [...], "relations": [...]} or None if unavailable.

    TODO(Phase 2 stretch): call the Anthropic Messages API with
    EXTRACTION_SYSTEM_PROMPT, parse the JSON body, and return it. Keep the
    broad except -- degrading to rule-based extraction is the correct failure mode.
    """
    settings = get_settings()
    if not settings.use_llm_extraction or not settings.anthropic_api_key:
        return None

    try:
        from anthropic import Anthropic

        client = Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=4096,
            system=EXTRACTION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": text}],
        )
        return json.loads(response.content[0].text)
    except Exception:
        logger.warning("LLM extraction unavailable; using rule-based output", exc_info=True)
        return None
