//! Skill validation utilities.
//!
//! Validates skill metadata against the expected schema,
//! matching the Zod validation in the TypeScript implementation.

mod meta;
mod skills;

pub use meta::validate_meta;
pub use skills::{validate_skills, SkillValidator};
