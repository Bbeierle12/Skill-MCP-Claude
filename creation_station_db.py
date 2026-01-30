from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import base64
import os
import sqlite3
from typing import Iterable

DEFAULT_DB_PATH = Path(__file__).parent / "creation_station.db"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db_path() -> Path:
    return Path(
        os.environ.get("CREATION_STATION_DB_PATH", str(DEFAULT_DB_PATH))
    ).resolve()


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path or get_db_path()))
    connection.row_factory = sqlite3.Row
    return connection


def init_db(db_path: Path | None = None) -> None:
    db_path = db_path or get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as conn:
        conn.executescript(
            """
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
            """
        )


@dataclass
class SkillFile:
    path: str
    content: str | bytes
    is_binary: bool


def load_skill_files(skill_dir: Path) -> list[SkillFile]:
    files: list[SkillFile] = []
    for file_path in skill_dir.rglob("*"):
        if not file_path.is_file():
            continue
        rel_path = str(file_path.relative_to(skill_dir)).replace("\\", "/")
        if file_path.suffix.lower() in {".md", ".json", ".txt"}:
            files.append(
                SkillFile(
                    path=rel_path,
                    content=file_path.read_text(encoding="utf-8"),
                    is_binary=False,
                )
            )
        else:
            files.append(
                SkillFile(
                    path=rel_path,
                    content=file_path.read_bytes(),
                    is_binary=True,
                )
            )
    return files


def upsert_skill(conn: sqlite3.Connection, name: str) -> int:
    row = conn.execute("SELECT id FROM skills WHERE name = ?", (name,)).fetchone()
    now = utc_now()
    if row:
        conn.execute(
            "UPDATE skills SET updated_at = ? WHERE id = ?", (now, row["id"])
        )
        return int(row["id"])
    cursor = conn.execute(
        "INSERT INTO skills (name, created_at, updated_at) VALUES (?, ?, ?)",
        (name, now, now),
    )
    return int(cursor.lastrowid)


def next_version_number(conn: sqlite3.Connection, skill_id: int) -> int:
    row = conn.execute(
        "SELECT MAX(version_number) AS max_version FROM skill_versions WHERE skill_id = ?",
        (skill_id,),
    ).fetchone()
    return int(row["max_version"] or 0) + 1


def create_version(
    conn: sqlite3.Connection,
    *,
    skill_id: int,
    files: Iterable[SkillFile],
    status: str,
    summary: str | None = None,
    published: bool = False,
) -> int:
    version_number = next_version_number(conn, skill_id)
    created_at = utc_now()
    published_at = created_at if published else None
    cursor = conn.execute(
        """
        INSERT INTO skill_versions (
            skill_id, version_number, status, summary, created_at, published_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (skill_id, version_number, status, summary, created_at, published_at),
    )
    version_id = int(cursor.lastrowid)
    for skill_file in files:
        if skill_file.is_binary:
            content_blob = (
                skill_file.content
                if isinstance(skill_file.content, bytes)
                else base64.b64decode(skill_file.content)
            )
            conn.execute(
                """
                INSERT INTO skill_files (
                    skill_version_id, path, content_blob, is_binary, encoding, created_at
                )
                VALUES (?, ?, ?, 1, 'base64', ?)
                """,
                (version_id, skill_file.path, content_blob, created_at),
            )
        else:
            conn.execute(
                """
                INSERT INTO skill_files (
                    skill_version_id, path, content_text, is_binary, encoding, created_at
                )
                VALUES (?, ?, ?, 0, 'utf-8', ?)
                """,
                (version_id, skill_file.path, str(skill_file.content), created_at),
            )
    return version_id


def publish_version(
    conn: sqlite3.Connection, skill_id: int, version_id: int
) -> None:
    published_at = utc_now()
    conn.execute(
        "UPDATE skill_versions SET status = ?, published_at = ? WHERE id = ?",
        ("published", published_at, version_id),
    )
    conn.execute(
        "UPDATE skills SET current_published_version_id = ?, updated_at = ? WHERE id = ?",
        (version_id, published_at, skill_id),
    )


def fetch_skill_versions(conn: sqlite3.Connection, skill_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, version_number, status, summary, created_at, published_at
        FROM skill_versions
        WHERE skill_id = ?
        ORDER BY version_number DESC
        """,
        (skill_id,),
    ).fetchall()


def fetch_version_files(
    conn: sqlite3.Connection, version_id: int
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT path, content_text, content_blob, is_binary, encoding
        FROM skill_files
        WHERE skill_version_id = ?
        ORDER BY path
        """,
        (version_id,),
    ).fetchall()


def decode_skill_file(row: sqlite3.Row) -> SkillFile:
    if row["is_binary"]:
        return SkillFile(
            path=row["path"],
            content=bytes(row["content_blob"] or b""),
            is_binary=True,
        )
    return SkillFile(path=row["path"], content=row["content_text"] or "", is_binary=False)


def seed_skills_from_filesystem(skills_dir: Path, db_path: Path | None = None) -> None:
    with connect(db_path) as conn:
        for skill_dir in skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            skill_id = upsert_skill(conn, skill_dir.name)
            existing = conn.execute(
                "SELECT COUNT(*) AS count FROM skill_versions WHERE skill_id = ?",
                (skill_id,),
            ).fetchone()
            if existing and existing["count"]:
                continue
            files = load_skill_files(skill_dir)
            version_id = create_version(
                conn,
                skill_id=skill_id,
                files=files,
                status="published",
                summary="Seeded from filesystem",
                published=True,
            )
            publish_version(conn, skill_id, version_id)


def write_version_to_filesystem(
    conn: sqlite3.Connection, version_id: int, destination: Path
) -> None:
    files = fetch_version_files(conn, version_id)
    for row in files:
        skill_file = decode_skill_file(row)
        target_path = destination / skill_file.path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if skill_file.is_binary:
            target_path.write_bytes(skill_file.content)  # type: ignore[arg-type]
        else:
            target_path.write_text(str(skill_file.content), encoding="utf-8")
