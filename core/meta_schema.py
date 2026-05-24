# core/meta_schema.py
# Thin adapter that validates a skill's _meta dict against the canonical JSON
# Schema. The schema file (schema/meta.schema.json at the repo root) is the
# single source of truth shared with the TypeScript (ajv) validator — this
# module deliberately does NOT define the field set itself.

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft7Validator

# Repo root is one level above core/.
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "meta.schema.json"


@lru_cache(maxsize=1)
def _validator() -> Draft7Validator:
    """Load and compile the canonical schema once."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def validate_meta(meta: dict) -> list[str]:
    """Validate a ``_meta`` dict against the canonical schema.

    Returns a list of human-readable error strings; an empty list means the
    metadata conforms to the contract.
    """
    errors: list[str] = []
    for err in sorted(_validator().iter_errors(meta), key=lambda e: list(e.path)):
        loc = ".".join(str(p) for p in err.path) or "<root>"
        errors.append(f"{loc}: {err.message}")
    return errors


def is_valid_meta(meta: dict) -> bool:
    """Return True if ``meta`` conforms to the canonical schema."""
    return not validate_meta(meta)
