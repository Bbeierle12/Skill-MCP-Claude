//! Canonical `_meta` validation.
//!
//! Validates a raw `_meta.json` value against the single source of truth:
//! `schema/meta.schema.json` at the repo root — the same file the Python
//! (jsonschema) and TypeScript (ajv) validators use. The schema is embedded at
//! compile time, so the build and the conformance tests depend on the canonical
//! contract: change the schema and this surface re-validates against the change.

use std::sync::OnceLock;

use jsonschema::Validator;
use serde_json::Value;

/// The canonical schema, embedded from the repo root at compile time.
const CANONICAL_SCHEMA: &str = include_str!("../../../../schema/meta.schema.json");

/// Compile the canonical schema once and reuse it.
fn validator() -> &'static Validator {
    static VALIDATOR: OnceLock<Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value = serde_json::from_str(CANONICAL_SCHEMA)
            .expect("canonical meta.schema.json is valid JSON");
        jsonschema::validator_for(&schema).expect("canonical meta.schema.json compiles")
    })
}

/// Validate a raw `_meta` JSON value against the canonical schema.
///
/// Returns a list of human-readable error strings; an empty list means the
/// metadata conforms to the contract. Mirrors `core.meta_schema.validate_meta`
/// (Python) and `validateMeta` (TypeScript).
pub fn validate_meta_json(value: &Value) -> Vec<String> {
    validator()
        .iter_errors(value)
        .map(|error| {
            let path = error.instance_path().to_string();
            if path.is_empty() {
                error.to_string()
            } else {
                format!("{}: {}", path, error)
            }
        })
        .collect()
}

/// Return `true` if `value` conforms to the canonical schema.
pub fn is_valid_meta_json(value: &Value) -> bool {
    validator().is_valid(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_minimal_meta() {
        let meta = json!({"name": "forms", "description": "Form patterns"});
        assert!(is_valid_meta_json(&meta));
        assert!(validate_meta_json(&meta).is_empty());
    }

    #[test]
    fn rejects_bad_name() {
        let meta = json!({"name": "Bad_Name", "description": "x"});
        assert!(!is_valid_meta_json(&meta));
        assert!(validate_meta_json(&meta).iter().any(|e| e.contains("name")));
    }

    #[test]
    fn rejects_unknown_field() {
        let meta = json!({"name": "ok", "description": "x", "mystery": 1});
        assert!(!is_valid_meta_json(&meta));
    }

    #[test]
    fn rejects_bad_type_enum() {
        let meta = json!({"name": "ok", "description": "x", "type": "bogus"});
        assert!(!is_valid_meta_json(&meta));
    }
}
