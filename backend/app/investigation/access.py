"""Who may compare which cases. Checked before anything is matched.

Consumed by the investigation router and investigation.service.

Case ids arriving from a client are a request, never a permission. Every
workspace request re-resolves the caller's live grants, so an expired or
revoked grant closes the workspace at once rather than at the next login.

Refusals are deliberately uniform. "No such case" and "not yours" produce the
same answer, so the API cannot be used to learn that a case exists, how many
there are, or whether a name matches something in a file the caller may not
read.

Identity here is a demo stand-in: the caller names themselves in a header and
nothing authenticates that claim. Real case data stays out until an actual
identity provider replaces it (MASTER_PLAN.md section 7).
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.investigation.models import CaseGrant, Principal, Workspace

REVIEWER_ROLES = frozenset({"reviewer"})

UNAVAILABLE = "One or more requested cases are unavailable to you."
WORKSPACE_UNAVAILABLE = "Workspace not found."


class AccessDenied(Exception):
    """Refused. The message is safe to show: it never says why."""


class NotAuthenticated(Exception):
    """No acting principal could be resolved from the request."""


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    # SQLite hands back naive datetimes; they were written as UTC.
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


def resolve_principal(db: Session, handle: str | None) -> Principal:
    if not handle:
        raise NotAuthenticated("Name the acting principal in the X-Principal header.")
    principal = db.scalar(select(Principal).where(Principal.handle == handle.strip()))
    if principal is None:
        raise NotAuthenticated("Unknown principal.")
    return principal


def active_grants(
    db: Session,
    principal: Principal,
    now: datetime | None = None,
    *,
    purpose: str | None = None,
) -> list[CaseGrant]:
    """Grants in force now; for a purpose, only grants given for that purpose."""
    moment = _now(now)
    grants = db.scalars(select(CaseGrant).where(CaseGrant.principal_id == principal.id)).all()
    return [
        grant
        for grant in grants
        if grant.revoked_at is None
        and (grant.expires_at is None or _aware(grant.expires_at) > moment)
        and (purpose is None or grant.purpose == purpose)
    ]


def authorized_case_ids(
    db: Session, principal: Principal, now: datetime | None = None, *, purpose: str | None = None
) -> set[int]:
    return {grant.case_id for grant in active_grants(db, principal, now, purpose=purpose)}


def require_cases(
    db: Session,
    principal: Principal,
    case_ids: Iterable[int],
    now: datetime | None = None,
    *,
    purpose: str | None = None,
) -> list[int]:
    """The requested cases, if every one is granted; otherwise a uniform refusal.

    With a purpose, each case must be granted for that purpose: access given to
    review a loan-app complaint does not stretch to comparing it with a
    trafficking inquiry.
    """
    requested = sorted(set(case_ids))
    granted = authorized_case_ids(db, principal, now, purpose=purpose)
    if not requested or not set(requested) <= granted:
        raise AccessDenied(UNAVAILABLE)
    return requested


def require_workspace(
    db: Session, principal: Principal, workspace_id: int, now: datetime | None = None
) -> Workspace:
    """A workspace the caller may open right now.

    The owner may open it; so may a reviewer. Either way, every case in it must
    still be granted to the caller, for the workspace's purpose, at this moment.
    """
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise AccessDenied(WORKSPACE_UNAVAILABLE)
    if workspace.principal_id != principal.id and principal.role not in REVIEWER_ROLES:
        raise AccessDenied(WORKSPACE_UNAVAILABLE)
    granted = authorized_case_ids(db, principal, now, purpose=workspace.purpose)
    if not set(workspace.case_ids or []) <= granted:
        raise AccessDenied(WORKSPACE_UNAVAILABLE)
    return workspace


def permission_version(
    db: Session, principal: Principal, case_ids: Iterable[int], now: datetime | None = None
) -> str:
    """Changes whenever the caller's grants over these cases change.

    Part of every cache key, so a result computed under one set of grants is
    never served under another.
    """
    wanted = set(case_ids)
    parts = sorted(
        f"{grant.id}:{grant.case_id}:{grant.purpose}:{grant.expires_at}:{grant.revoked_at}"
        for grant in active_grants(db, principal, now)
        if grant.case_id in wanted
    )
    return hashlib.sha256("|".join([str(principal.id), *parts]).encode()).hexdigest()[:16]
