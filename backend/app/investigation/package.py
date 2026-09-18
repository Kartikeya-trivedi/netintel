"""Signed, reproducible finding packages, and the checks that verify them.

Consumed by investigation.service (export), the investigation router and
app.investigation.verify (the command-line verifier).

A package is a zip:

    manifest.json     every other file with its sha256, and what was exported
    signature.json    Ed25519 over the canonical manifest bytes, and the key id
    finding.json      the finding as computed, with its explanations and limits
    scenario.json     the scenario, subjects and decisions it was computed under
    artifacts.json    per original: case code, filename, kind, source
    originals/<sha>   the original bytes of every artifact in the workspace

What verification means is kept narrow on purpose. Integrity says the package
matches what the holder of a trusted key signed; it says nothing about whether
a source is true. Reproduction says the stated result follows from the
included originals under the stated decisions; it does not validate the
investigative hypothesis. And the verifier never trusts a key the package
carries itself: a tamperer who can edit the package can re-sign it too.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import os
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

FORMAT = "netintel-finding-package/1"
MANIFEST = "manifest.json"
SIGNATURE = "signature.json"
_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


# --- Keys ----------------------------------------------------------------------------


def load_or_create_key(path: Path) -> Ed25519PrivateKey:
    """The local signing key, created on first use.

    A file on disk is a demonstration of the mechanism, not key custody. A
    deployment keeps this in an HSM or a managed KMS and rotates it.
    """
    path = Path(path)
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("Signing key is not Ed25519")
        return key
    key = Ed25519PrivateKey.generate()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    # Owner-only where the filesystem supports it; Windows ignores the mode.
    with contextlib.suppress(OSError):
        os.chmod(path, 0o600)
    return key


def public_key_pem(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def key_id(public: Ed25519PublicKey) -> str:
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()[:16]


def load_public_key(pem: bytes) -> Ed25519PublicKey:
    key = serialization.load_pem_public_key(pem)
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("Public key is not Ed25519")
    return key


# --- Writing ---------------------------------------------------------------------------


def write_package(
    files: dict[str, bytes], manifest: dict, key: Ed25519PrivateKey
) -> tuple[bytes, dict]:
    """Seal ``files`` under a signed manifest. Entries are ordered and dated
    identically every time, so the same content yields the same zip bytes."""
    listed = {
        name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        for name, data in sorted(files.items())
    }
    sealed = {**manifest, "format": FORMAT, "files": listed}
    manifest_bytes = canonical(sealed)
    signature = {
        "algorithm": "Ed25519",
        "key_id": key_id(key.public_key()),
        "signed_file": MANIFEST,
        "signature": base64.b64encode(key.sign(manifest_bytes)).decode("ascii"),
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        entries = {MANIFEST: manifest_bytes, SIGNATURE: canonical(signature), **files}
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, entries[name])
    return buffer.getvalue(), sealed


# --- Verifying --------------------------------------------------------------------------


@dataclass
class Report:
    integrity: str = "failed"  # verified | failed | unchecked
    reproduction: str = "not requested"  # reproduced | mismatch | not possible | not requested
    checks: list[dict] = field(default_factory=list)
    manifest: dict | None = None

    def add(self, name: str, ok: bool | None, detail: str) -> None:
        self.checks.append({"check": name, "ok": ok, "detail": detail})

    def as_dict(self) -> dict:
        return {
            "integrity": self.integrity,
            "reproduction": self.reproduction,
            "checks": self.checks,
            "finding": (self.manifest or {}).get("finding"),
            "title": (self.manifest or {}).get("title"),
            "status": (self.manifest or {}).get("status"),
            "exported_at": (self.manifest or {}).get("exported_at"),
            "scope": "Integrity is checked against the supplied key only. It does not "
            "establish that any source is true.",
        }


def verify_package(data: bytes, public_pem: bytes | None, *, reproduce: bool = False) -> Report:
    report = Report()
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        report.add("archive", False, "Not a zip archive")
        return report

    with archive:
        names = set(archive.namelist())
        if MANIFEST not in names or SIGNATURE not in names:
            report.add("archive", False, "manifest.json or signature.json is missing")
            return report
        manifest_bytes = archive.read(MANIFEST)
        try:
            manifest = json.loads(manifest_bytes)
            signature = json.loads(archive.read(SIGNATURE))
        except json.JSONDecodeError as exc:
            report.add("archive", False, f"Unreadable manifest or signature: {exc}")
            return report
        report.manifest = manifest
        report.add("archive", True, f"{len(names)} entries")

        if manifest.get("format") != FORMAT:
            report.add("format", False, f"Unknown format {manifest.get('format')!r}")
            return report

        signed_ok: bool | None = None
        if public_pem is None:
            report.add("signature", None, "Not checked: no trusted public key was supplied")
        else:
            try:
                public = load_public_key(public_pem)
                if signature.get("key_id") != key_id(public):
                    report.add(
                        "signature", False, "Signed with a different key than the one supplied"
                    )
                    signed_ok = False
                else:
                    public.verify(base64.b64decode(signature["signature"]), manifest_bytes)
                    report.add("signature", True, f"Ed25519, key {signature['key_id']}")
                    signed_ok = True
            except (InvalidSignature, ValueError, KeyError) as exc:
                report.add("signature", False, f"Signature does not verify ({type(exc).__name__})")
                signed_ok = False

        listed = manifest.get("files", {})
        files_ok = True
        for name, meta in sorted(listed.items()):
            if name not in names:
                report.add(f"file:{name}", False, "Listed in the manifest but missing")
                files_ok = False
                continue
            actual = hashlib.sha256(archive.read(name)).hexdigest()
            if actual != meta.get("sha256"):
                report.add(f"file:{name}", False, "Contents differ from the signed digest")
                files_ok = False
        extra = sorted(names - set(listed) - {MANIFEST, SIGNATURE})
        for name in extra:
            report.add(f"file:{name}", False, "Present but not covered by the manifest")
            files_ok = False
        if files_ok:
            report.add("files", True, f"All {len(listed)} files match their signed digests")

        if not files_ok or signed_ok is False:
            report.integrity = "failed"
        elif signed_ok is None:
            report.integrity = "unchecked"
        else:
            report.integrity = "verified"

        if reproduce:
            if report.integrity == "failed":
                report.reproduction = "not possible"
                report.add("reproduction", None, "Skipped: the package failed integrity checks")
            else:
                _reproduce(archive, report)
    return report


def _reproduce(archive: zipfile.ZipFile, report: Report) -> None:
    """Re-extract every included original and recompute the finding."""
    from app.investigation import engine as E
    from app.investigation import lineage
    from app.investigation.extract import extract

    try:
        finding = json.loads(archive.read("finding.json"))
        scenario_doc = json.loads(archive.read("scenario.json"))
        artifacts = json.loads(archive.read("artifacts.json"))
    except KeyError as exc:
        report.reproduction = "not possible"
        report.add("reproduction", None, f"Missing input {exc}")
        return

    assertions: list[E.Assertion] = []
    infos: dict[tuple[str, str], lineage.ArtifactInfo] = {}
    for entry in artifacts:
        name = f"originals/{entry['sha256']}"
        try:
            raw = archive.read(name)
        except KeyError:
            report.reproduction = "not possible"
            report.add("reproduction", None, f"Original {entry['filename']} is not included")
            return
        extraction = extract(raw, case=entry["case"], kind=entry["kind"], sha256=entry["sha256"])
        assertions.extend(extraction.assertions)
        infos[(entry["case"], entry["sha256"])] = lineage.ArtifactInfo(
            sha256=entry["sha256"],
            case=entry["case"],
            filename=entry["filename"],
            kind=entry["kind"],
            reference=extraction.reference,
            source_reference=extraction.source_reference,
            document_date=extraction.document_date,
        )

    assertions.sort(key=lambda a: a.key)
    snapshot = E.Snapshot(
        cases=tuple(scenario_doc["cases"]),
        assertions=tuple(assertions),
        links=tuple(lineage.detect(assertions, infos)),
        decisions=tuple(
            E.IdentityDecision(d["candidate"], d["a"], d["b"], d["state"], tuple(d["evidence"]))
            for d in scenario_doc["decisions"]["identity"]
        ),
        reviews=dict(scenario_doc["decisions"]["reviews"]),
        groupings=dict(scenario_doc["decisions"]["groupings"]),
    )
    scenario = E.Scenario.from_dict(scenario_doc["scenario"])
    projection = E.derive(snapshot, scenario, subjects=scenario_doc["subjects"])

    expected = finding["reproducible"]
    recomputed = projection.findings.get(expected["key"])
    got = reproducible_view(projection, recomputed) if recomputed else None
    if got == expected:
        report.reproduction = "reproduced"
        report.add(
            "reproduction",
            True,
            f"Recomputed from {len(artifacts)} originals: status {expected['status']}, "
            f"{len(expected['explanations'])} explanation(s), identical support",
        )
    else:
        report.reproduction = "mismatch"
        status = recomputed.status if recomputed else "no finding"
        report.add(
            "reproduction",
            False,
            f"Recomputed status {status} against stated {expected['status']}, "
            "or the support differs",
        )


def reproducible_view(projection, finding) -> dict:
    """The part of a finding a verifier must be able to recompute exactly."""
    from app.investigation import engine as E

    used = sorted({key for x in finding.explanations for step in x.steps for key in step.edges})
    return {
        "key": finding.key,
        "status": finding.status,
        "explanations": [[x.key, x.status] for x in finding.explanations],
        "edges": {
            key: sorted(sorted(d) for d in projection.edges[key].derivations)
            for key in used
            if key in projection.edges
        },
        "engine": E.ENGINE_VERSION,
    }


def exported_at() -> str:
    from datetime import UTC

    return datetime.now(UTC).isoformat(timespec="seconds")
