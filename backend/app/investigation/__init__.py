"""Investigation layer: preserved originals, assertions, findings, and challenges.

MASTER_PLAN.md turns NetIntel from a graph viewer into an investigation
workspace. This package is that workspace's backend, built beside the existing
case pipeline rather than on top of it:

    store          originals kept byte for byte, addressed by their sha256
    extract        one original -> evidence items -> typed assertions
    lineage        which claims repeat or derive from which origin
    engine         assertions -> relationships -> findings, every dependency kept
    sensitivity    what a finding needs, and which withdrawals break it
    verification   which review would change the most findings
    package        signed, reproducible finding exports and their verifier
    access, audit  who may compare which cases, and what they decided

The engine is pure: no database, no clock, no randomness. That is what makes a
scenario comparable with its baseline and an exported finding reproducible.
"""
