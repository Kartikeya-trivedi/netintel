"""The evaluation harness, held to what it measured on the default scenario.

Ground truth enters only through app.investigation.evaluate. These tests pin
the headline behaviour so a change to the engine or the planner that quietly
reintroduces a false connection, or wastes the first check, fails loudly.
"""

from __future__ import annotations

import pytest

from app.investigation import engine as E
from app.investigation.evaluate import Judge, evaluate_variant, load_variant


@pytest.fixture(scope="module")
def variant():
    return load_variant(0)


def test_the_real_bridge_is_sound_and_the_tip_route_is_not(variant):
    baseline = E.derive(variant.snapshot, subjects=variant.subjects)
    judge = Judge(variant, baseline)
    labels = {k: p.label for k, p in baseline.persons.items()}
    findings = {(labels[f.a], labels[f.b]): f for f in baseline.findings.values()}

    bridge = findings[("Vikram Rane", "Pappu Shinde")].explanations[0]
    assert judge.sound(bridge)
    (tip_route,) = findings[("Sameer Khan", "Pappu Shinde")].explanations
    assert not judge.sound(tip_route)


def test_headline_results_on_the_default_scenario(variant):
    result = evaluate_variant(variant, random_orders=3)
    assert result["naive"]["false_asserted"] == 1
    assert result["netintel"]["false_asserted"] == 0
    assert result["netintel"]["misleading_first"] == 0
    assert (result["netintel"]["leads"], result["netintel"]["false_leads"]) == (1, 1)
    # The contradiction is checked first, and settles the false lead on its own.
    assert result["reviews"]["planner"] == 1
