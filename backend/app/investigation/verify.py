"""Verify an exported finding package, away from the system that made it.

Run:  uv run python -m app.investigation.verify package.zip --public-key key.pem [--reproduce]

Needs no database and no server: only the package and a public key obtained
through a separate, trusted channel. With --reproduce it re-extracts every
included original and recomputes the finding from scratch.

Exit status: 0 when integrity is verified (and, with --reproduce, the finding
reproduced); 1 otherwise. A package checked without a key never exits 0,
because unchecked is not verified.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.investigation.package import verify_package


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a NetIntel finding package.")
    parser.add_argument("package", type=Path)
    parser.add_argument("--public-key", type=Path, help="Trusted Ed25519 public key (PEM)")
    parser.add_argument("--reproduce", action="store_true", help="Recompute the finding")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    args = parser.parse_args(argv)

    public = args.public_key.read_bytes() if args.public_key else None
    report = verify_package(args.package.read_bytes(), public, reproduce=args.reproduce).as_dict()

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Finding:      {report['title'] or report['finding']}")
        print(f"Integrity:    {report['integrity']}")
        print(f"Reproduction: {report['reproduction']}")
        for check in report["checks"]:
            mark = {True: "ok ", False: "BAD", None: " - "}[check["ok"]]
            print(f"  [{mark}] {check['check']}: {check['detail']}")
        print(report["scope"])

    passed = report["integrity"] == "verified" and (
        not args.reproduce or report["reproduction"] == "reproduced"
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
