# tests/test_meta_conformance.py
# Conformance test for the canonical _meta contract (Python side).
#
# The Python (jsonschema) and TypeScript (ajv) validators load the SAME schema
# (schema/meta.schema.json) and the SAME fixtures (schema/fixtures/*.json). This
# test and its TS twin (skills-mcp-server/test/conformance.test.ts) prove the two
# adapters converge: both accept the good fixture and both reject the bad one.

import json
from pathlib import Path

import pytest

from core.meta_schema import is_valid_meta, validate_meta

FIXTURES = Path(__file__).resolve().parent.parent / "schema" / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_valid_fixture_is_accepted():
    """The shared good fixture (full v2.0 _meta) conforms to the contract."""
    assert validate_meta(_load("meta.valid.json")) == []
    assert is_valid_meta(_load("meta.valid.json"))


def test_invalid_fixture_is_rejected():
    """The shared bad fixture is rejected for the canonical-contract rules."""
    errors = validate_meta(_load("meta.invalid.json"))
    assert errors, "invalid fixture must produce validation errors"
    joined = " ".join(errors)
    # The bad name (uppercase + underscore) violates the name pattern.
    assert "name" in joined
    assert not is_valid_meta(_load("meta.invalid.json"))


def test_all_real_skills_conform():
    """Every shipped skill's _meta.json must satisfy the canonical contract."""
    skills_dir = Path(__file__).resolve().parent.parent / "skills"
    metas = sorted(skills_dir.glob("*/_meta.json"))
    assert metas, "expected at least one skill _meta.json"
    failures = {}
    for meta_path in metas:
        errs = validate_meta(json.loads(meta_path.read_text(encoding="utf-8")))
        if errs:
            failures[meta_path.parent.name] = errs
    assert not failures, f"non-conforming skills: {failures}"


@pytest.mark.parametrize(
    "meta",
    [
        {"description": "missing name"},
        {"name": "ok"},  # missing description
        {"name": "Bad_Name", "description": "uppercase + underscore"},
        {"name": "ok", "description": "x", "type": "bogus"},
        {"name": "ok", "description": "x", "relevance_tier": "Z"},
        {"name": "ok", "description": "x", "extra_field": True},
        {"name": "ok", "description": "x", "tags": "not-a-list"},
    ],
)
def test_known_bad_shapes_are_rejected(meta):
    assert validate_meta(meta), f"should have rejected: {meta}"
