//! Skill indexing service.
//!
//! Responsible for scanning skill directories, building metadata indexes,
//! and creating content indexes for full-text search.

mod indexer;
mod file_watcher;

pub use indexer::{IndexError, SkillIndexer};
pub use file_watcher::{FileWatcher, WatchError};
