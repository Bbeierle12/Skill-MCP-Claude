//! Skill validation utilities.
//!
//! `canonical` validates a raw `_meta.json` against `schema/meta.schema.json`,
//! the single source of truth shared with the Python (jsonschema) and TypeScript
//! (ajv) validators. `meta`/`skills` layer additional structural and file-system
//! checks on top of the deserialized model.

mod canonical;
mod meta;
mod skills;

pub use canonical::{is_valid_meta_json, validate_meta_json};
pub use meta::validate_meta;
pub use skills::{validate_skills, SkillValidator};
