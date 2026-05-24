//! Conformance test for the canonical `_meta` contract — Rust, the third witness.
//!
//! Loads the SAME `schema/fixtures/meta.{valid,invalid}.json` that the Python
//! (`tests/test_meta_conformance.py`) and TypeScript
//! (`skills-mcp-server/test/conformance.test.ts`) suites use, and asserts the
//! Rust adapter converges with them: the good fixture is accepted, the bad one
//! rejected. A change to `schema/meta.schema.json` that breaks the contract
//! turns this test — and therefore the Rust CI job — red.

use serde_json::Value;
use skills_mcp::validation::{is_valid_meta_json, validate_meta_json};

const VALID_FIXTURE: &str = include_str!("../../../schema/fixtures/meta.valid.json");
const INVALID_FIXTURE: &str = include_str!("../../../schema/fixtures/meta.invalid.json");

fn parse(s: &str) -> Value {
    serde_json::from_str(s).expect("fixture is valid JSON")
}

#[test]
fn accepts_shared_valid_fixture() {
    let meta = parse(VALID_FIXTURE);
    let errors = validate_meta_json(&meta);
    assert!(errors.is_empty(), "expected valid fixture to pass, got: {errors:?}");
    assert!(is_valid_meta_json(&meta));
}

#[test]
fn rejects_shared_invalid_fixture() {
    let meta = parse(INVALID_FIXTURE);
    let errors = validate_meta_json(&meta);
    assert!(!errors.is_empty(), "expected invalid fixture to be rejected");
    assert!(
        errors.iter().any(|e| e.contains("name")),
        "expected a name-related error, got: {errors:?}"
    );
}
