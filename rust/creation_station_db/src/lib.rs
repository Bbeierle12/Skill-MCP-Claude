use chrono::{DateTime, Utc};
use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DEFAULT_DB_PATH: &str = "creation_station.db";

#[derive(Debug, Clone)]
pub struct DbConfig {
    pub db_path: PathBuf,
}

impl Default for DbConfig {
    fn default() -> Self {
        Self {
            db_path: PathBuf::from(DEFAULT_DB_PATH),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFile {
    pub path: String,
    pub content: Vec<u8>,
    pub is_binary: bool,
    pub encoding: String,
}

pub fn utc_now() -> DateTime<Utc> {
    Utc::now()
}

pub fn connect(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

pub fn init_db(db_path: &Path) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(err))
        })?;
    }
    let conn = connect(db_path)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            current_published_version_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            status TEXT NOT NULL,
            summary TEXT,
            created_at TEXT NOT NULL,
            published_at TEXT,
            content_hash TEXT,
            FOREIGN KEY(skill_id) REFERENCES skills(id)
        );

        CREATE TABLE IF NOT EXISTS skill_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_version_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            content_text TEXT,
            content_blob BLOB,
            is_binary INTEGER NOT NULL DEFAULT 0,
            encoding TEXT NOT NULL DEFAULT 'utf-8',
            created_at TEXT NOT NULL,
            FOREIGN KEY(skill_version_id) REFERENCES skill_versions(id)
        );

        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            runtime TEXT NOT NULL,
            model_label TEXT,
            prompt_text TEXT NOT NULL,
            settings_json TEXT,
            selected_skills_json TEXT,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            latency_ms INTEGER,
            error_text TEXT
        );

        CREATE TABLE IF NOT EXISTS run_outputs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            output_text TEXT,
            stdout_text TEXT,
            stderr_text TEXT,
            return_code INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES runs(id)
        );

        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            rating TEXT NOT NULL,
            tags_json TEXT,
            comment_text TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES runs(id)
        );

        CREATE TABLE IF NOT EXISTS test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            context_json TEXT,
            expected_traits_json TEXT,
            forbidden_traits_json TEXT,
            rubric_json TEXT,
            linked_skill_name TEXT,
            linked_skill_version_id INTEGER
        );
        "#,
    )?;
    Ok(())
}
