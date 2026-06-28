use rusqlite::{Connection, Result, params};
use std::path::Path;
use chrono::Utc;
use serde::{Serialize, Deserialize};

/// Represents a single agent experience log (success, failure, or reflection).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperienceLog {
    pub id: i64,
    pub task_context: String,
    pub error_trace: Option<String>,
    pub resolution: Option<String>,
    pub timestamp: String,
}

/// The local storage engine for agentic memory.
pub struct MemoryVault {
    conn: Connection,
}

impl MemoryVault {
    /// Opens the SQLite database at the given path and initializes the schema.
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        let vault = Self { conn };
        vault.init_schema()?;
        Ok(vault)
    }

    /// Initializes the SQLite schema for storing experience logs.
    fn init_schema(&self) -> Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS experience_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_context TEXT NOT NULL,
                error_trace TEXT,
                resolution TEXT,
                timestamp TEXT NOT NULL
            )",
            [],
        )?;
        Ok(())
    }

    /// Logs a new agent experience into the memory vault.
    pub fn log_experience(
        &self,
        task_context: &str,
        error_trace: Option<&str>,
        resolution: Option<&str>,
    ) -> Result<i64> {
        let timestamp = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO experience_logs (task_context, error_trace, resolution, timestamp) 
             VALUES (?1, ?2, ?3, ?4)",
            params![task_context, error_trace, resolution, timestamp],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Retrieves all recorded experience logs, ordered from newest to oldest.
    pub fn get_all_logs(&self) -> Result<Vec<ExperienceLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_context, error_trace, resolution, timestamp 
             FROM experience_logs 
             ORDER BY timestamp DESC"
        )?;
        let log_iter = stmt.query_map([], |row| {
            Ok(ExperienceLog {
                id: row.get(0)?,
                task_context: row.get(1)?,
                error_trace: row.get(2)?,
                resolution: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;

        let mut logs = Vec::new();
        for log in log_iter {
            logs.push(log?);
        }
        Ok(logs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_vault_crud() -> Result<()> {
        // Use in-memory database for testing
        let vault = MemoryVault::new(":memory:")?;
        
        let id = vault.log_experience(
            "Compiled Rust project",
            Some("Failed due to missing dependency 'rusqlite'"),
            Some("Added 'rusqlite' to Cargo.toml and re-ran cargo build")
        )?;
        assert!(id > 0);

        let logs = vault.get_all_logs()?;
        assert_eq!(logs.len(), 1);
        
        let log = &logs[0];
        assert_eq!(log.task_context, "Compiled Rust project");
        assert_eq!(log.error_trace.as_deref(), Some("Failed due to missing dependency 'rusqlite'"));
        assert_eq!(log.resolution.as_deref(), Some("Added 'rusqlite' to Cargo.toml and re-ran cargo build"));
        assert!(!log.timestamp.is_empty());
        
        Ok(())
    }
}
