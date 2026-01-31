# skills_manager_api.py
# HTTP API server for managing skills with Claude Code CLI integration
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS
from pathlib import Path
import json
import re
import subprocess
import os
import shutil
import base64
import binascii
from datetime import datetime, timezone
from typing import Any

from creation_station_db import (
    connect,
    create_version,
    decode_skill_file,
    fetch_skill_versions,
    fetch_version_files,
    init_db,
    load_skill_files,
    publish_version,
    seed_skills_from_filesystem,
    upsert_skill,
    write_version_to_filesystem,
    SkillFile,
)

app = Flask(__name__)
CORS(app)

SKILLS_DIR = Path(__file__).parent / "skills"
MAX_CONTEXT_CHARS = int(os.environ.get("MAX_CONTEXT_CHARS", "12000"))
MAX_OUTPUT_CHARS = int(os.environ.get("MAX_OUTPUT_CHARS", "8000"))
RUN_TIMEOUT_SECONDS = int(os.environ.get("RUN_TIMEOUT_SECONDS", "180"))

init_db()
seed_skills_from_filesystem(SKILLS_DIR)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_safe_skill_name(name: str) -> bool:
    """Validate that a skill name is safe for filesystem operations.

    Only allows alphanumeric characters, hyphens, and underscores.
    Rejects path traversal attempts like '..' or names starting with '.'.
    """
    if not name or not isinstance(name, str):
        return False
    # Reject path traversal attempts
    if '..' in name or name.startswith('.'):
        return False
    # Only allow alphanumeric, hyphens, and underscores
    return bool(re.match(r'^[a-zA-Z0-9\-_]+$', name))


def validate_skill_path(skill_path: Path) -> bool:
    """Validate that a resolved path is within SKILLS_DIR.

    This provides defense-in-depth against path traversal attacks.
    """
    try:
        resolved_path = skill_path.resolve()
        skills_dir_resolved = SKILLS_DIR.resolve()
        return str(resolved_path).startswith(str(skills_dir_resolved))
    except (OSError, ValueError):
        return False


def sanitize_name(name: str) -> str:
    """Convert name to valid skill directory name."""
    return re.sub(r'[^a-z0-9-]', '-', name.lower().strip()).strip('-')


def escape_yaml_value(value: str) -> str:
    """Escape a string value for safe inclusion in YAML frontmatter.

    Handles special characters that could break YAML parsing:
    - Colons, which indicate key-value pairs
    - Newlines, which would break the structure
    - Quotes, which need escaping inside quoted strings
    - Leading/trailing spaces
    """
    if not value:
        return '""'

    # Check if value needs quoting
    needs_quoting = (
        ':' in value or
        '\n' in value or
        '\r' in value or
        '"' in value or
        "'" in value or
        '#' in value or
        value.startswith(' ') or
        value.endswith(' ') or
        value.startswith('[') or
        value.startswith('{') or
        value.lower() in ('true', 'false', 'null', 'yes', 'no', 'on', 'off')
    )

    if not needs_quoting:
        return value

    # Use double quotes and escape special characters
    escaped = value.replace('\\', '\\\\').replace('"', '\\"')
    escaped = escaped.replace('\n', '\\n').replace('\r', '\\r')
    return f'"{escaped}"'


# File upload validation constants
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_TOTAL_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB total
MAX_FILES_PER_UPLOAD = 100
MAX_PATH_DEPTH = 10
MAX_FILENAME_LENGTH = 255

# Allowed file extensions for skill content
ALLOWED_EXTENSIONS = {
    # Documentation
    '.md', '.markdown', '.txt', '.rst', '.adoc',
    # Code
    '.py', '.js', '.ts', '.jsx', '.tsx', '.rs', '.go', '.rb', '.java',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.scala',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
    # Config
    '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf',
    # Web
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    # Data
    '.csv', '.sql',
    # Images (for references)
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
    # Binary data
    '.bin', '.dat', '.wasm',
}


def validate_upload_path(file_path: str) -> tuple[bool, str]:
    """Validate an uploaded file path for security issues.

    Returns (is_valid, error_message). If valid, error_message is empty.
    """
    if not file_path:
        return False, "Empty file path"

    # Normalize path separators
    normalized = file_path.replace("\\", "/")

    # Check for path traversal
    if ".." in normalized:
        return False, "Path traversal detected"

    # Check for absolute paths
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        return False, "Absolute paths not allowed"

    # Check path depth
    parts = [p for p in normalized.split("/") if p]
    if len(parts) > MAX_PATH_DEPTH:
        return False, f"Path too deep (max {MAX_PATH_DEPTH} levels)"

    # Check filename length
    filename = parts[-1] if parts else ""
    if len(filename) > MAX_FILENAME_LENGTH:
        return False, f"Filename too long (max {MAX_FILENAME_LENGTH} chars)"

    # Check for hidden files (optional - uncomment to block)
    # if any(p.startswith('.') for p in parts):
    #     return False, "Hidden files/directories not allowed"

    # Check file extension
    if '.' in filename:
        ext = '.' + filename.rsplit('.', 1)[-1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            return False, f"File extension '{ext}' not allowed"

    # Check for null bytes and other control characters
    if any(ord(c) < 32 for c in file_path):
        return False, "Invalid characters in path"

    return True, ""


def find_claude_cli():
    """Find the Claude Code CLI executable."""
    possible_paths = [
        shutil.which('claude'),
        os.path.expanduser('~/.claude/claude.exe'),
        os.path.expanduser('~/.claude/claude'),
        'C:/Users/Bbeie/.claude/local/claude.exe',
        'claude.exe',
        'claude'
    ]
    for path in possible_paths:
        if path and os.path.exists(path):
            return path
    return shutil.which('claude')


def get_skill_record(conn, name: str) -> tuple[int, int | None] | None:
    row = conn.execute(
        "SELECT id, current_published_version_id FROM skills WHERE name = ?",
        (name,),
    ).fetchone()
    if not row:
        return None
    return int(row["id"]), row["current_published_version_id"]


def snapshot_skill_to_db(skill_name: str, summary: str) -> int:
    skill_dir = SKILLS_DIR / skill_name
    files = load_skill_files(skill_dir)
    with connect() as conn:
        skill_id = upsert_skill(conn, skill_name)
        version_id = create_version(
            conn,
            skill_id=skill_id,
            files=files,
            status="published",
            summary=summary,
            published=True,
        )
        publish_version(conn, skill_id, version_id)
        return version_id


def build_skill_context(selected_skills: list[dict[str, Any]]) -> tuple[str, bool]:
    sections: list[str] = []
    truncated = False
    for item in selected_skills:
        skill_name = item.get("skill_name") or item.get("name")
        if not skill_name:
            continue
        version_id = item.get("version_id")
        include_references = bool(item.get("include_references", False))

        header = f"## Skill: {skill_name}"
        skill_chunks = [header]
        content = ""
        references: list[str] = []
        with connect() as conn:
            if version_id:
                rows = fetch_version_files(conn, int(version_id))
                for row in rows:
                    file_path = row["path"]
                    file_content = decode_skill_file(row)
                    if file_path == "SKILL.md":
                        content = str(file_content.content)
                    elif include_references and file_path.startswith("references/"):
                        references.append(
                            f"### Reference: {file_path}\n{file_content.content}"
                        )
            else:
                skill_dir = SKILLS_DIR / skill_name
                skill_md = skill_dir / "SKILL.md"
                if skill_md.exists():
                    content = skill_md.read_text(encoding="utf-8")
                if include_references:
                    refs_dir = skill_dir / "references"
                    if refs_dir.exists():
                        for ref_file in refs_dir.rglob("*.md"):
                            references.append(
                                f"### Reference: {ref_file.name}\n"
                                f"{ref_file.read_text(encoding='utf-8')}"
                            )

        if content:
            skill_chunks.append(content)
        if references:
            skill_chunks.extend(references)
        sections.append("\n\n".join(skill_chunks))

    context = "\n\n---\n\n".join(sections)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS]
        truncated = True
    return context, truncated

@app.route('/')
def index():
    return send_from_directory('.', 'skills-manager.html')

@app.route('/api/skills', methods=['GET'])
def list_skills():
    """List all skills with their metadata."""
    include_content = request.args.get("include_content", "1") == "1"
    skills = []
    for skill_dir in SKILLS_DIR.iterdir():
        if skill_dir.is_dir():
            skill_data = {"name": skill_dir.name}
            
            meta_file = skill_dir / "_meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    skill_data.update(meta)
                except (json.JSONDecodeError, OSError) as e:
                    # Log but continue - metadata is optional
                    pass
            
            skill_file = skill_dir / "SKILL.md"
            if skill_file.exists() and include_content:
                content = skill_file.read_text(encoding="utf-8")
                skill_data["content"] = content
                if "description" not in skill_data and content.startswith("---"):
                    try:
                        end = content.index("---", 3)
                        frontmatter = content[3:end]
                        for line in frontmatter.split("\n"):
                            if line.startswith("description:"):
                                skill_data["description"] = line.split(":", 1)[1].strip()
                                break
                    except ValueError:
                        pass
            
            # Get file structure info
            skill_data["has_scripts"] = (skill_dir / "scripts").exists()
            skill_data["has_references"] = (skill_dir / "references").exists()
            skill_data["file_count"] = len(list(skill_dir.rglob("*")))
            
            skills.append(skill_data)
    
    return jsonify({"skills": skills})

@app.route('/api/skills/<name>', methods=['GET'])
def get_skill(name: str):
    """Get a specific skill's details including all files."""
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    version_id = request.args.get("version_id")
    include_content = request.args.get("include_content", "1") == "1"
    skill_dir = SKILLS_DIR / name

    # Validate the constructed path is within SKILLS_DIR
    if not validate_skill_path(skill_dir):
        return jsonify({"error": f"Invalid skill path: {name}"}), 400

    if not skill_dir.exists() and not version_id:
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    
    skill_data = {"name": name, "files": []}

    if version_id:
        with connect() as conn:
            rows = fetch_version_files(conn, int(version_id))
            for row in rows:
                file_path = row["path"]
                skill_data["files"].append(file_path)
                if include_content and file_path == "SKILL.md":
                    skill_data["content"] = decode_skill_file(row).content
            skill_data["version_id"] = int(version_id)
    else:
        meta_file = skill_dir / "_meta.json"
        if meta_file.exists():
            skill_data.update(json.loads(meta_file.read_text(encoding="utf-8")))

        skill_file = skill_dir / "SKILL.md"
        if skill_file.exists() and include_content:
            skill_data["content"] = skill_file.read_text(encoding="utf-8")

        # List all files in skill directory
        for f in skill_dir.rglob("*"):
            if f.is_file():
                rel_path = f.relative_to(skill_dir)
                skill_data["files"].append(str(rel_path))
    
    return jsonify(skill_data)

@app.route('/api/skills', methods=['POST'])
def create_skill():
    """Create a new skill."""
    data = request.json
    
    name = sanitize_name(data.get("name", ""))
    if not name:
        return jsonify({"error": "Skill name is required"}), 400
    
    skill_dir = SKILLS_DIR / name
    if skill_dir.exists() and not data.get("overwrite"):
        return jsonify({"error": f"Skill '{name}' already exists"}), 409
    
    skill_dir.mkdir(parents=True, exist_ok=True)

    description = data.get("description", "")
    content = data.get("content", "")

    escaped_name = escape_yaml_value(name)
    escaped_desc = escape_yaml_value(description)
    skill_md = f"""---
name: {escaped_name}
description: {escaped_desc}
---

{content}
"""
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    meta = {
        "name": name,
        "description": description,
        "tags": data.get("tags", []),
        "sub_skills": data.get("sub_skills", []),
        "source": "imported"
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    version_id = snapshot_skill_to_db(name, "Created via API")

    return jsonify({"success": True, "name": name, "path": str(skill_dir), "version_id": version_id})

@app.route('/api/skills/<name>', methods=['PUT'])
def update_skill(name: str):
    """Update an existing skill."""
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    skill_dir = SKILLS_DIR / name

    # Validate the constructed path is within SKILLS_DIR
    if not validate_skill_path(skill_dir):
        return jsonify({"error": f"Invalid skill path: {name}"}), 400

    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    
    data = request.json
    description = data.get("description", "")
    content = data.get("content", "")

    escaped_name = escape_yaml_value(name)
    escaped_desc = escape_yaml_value(description)
    skill_md = f"""---
name: {escaped_name}
description: {escaped_desc}
---

{content}
"""
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    meta_file = skill_dir / "_meta.json"
    meta = {}
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # Continue with empty meta if parsing fails
            pass
    
    meta.update({
        "name": name,
        "description": description,
        "tags": data.get("tags", meta.get("tags", []))
    })
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    version_id = snapshot_skill_to_db(name, "Updated via API")

    return jsonify({"success": True, "name": name, "version_id": version_id})

@app.route('/api/skills/<name>', methods=['DELETE'])
def delete_skill(name: str):
    """Delete a skill."""
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    skill_dir = SKILLS_DIR / name

    # Validate the constructed path is within SKILLS_DIR
    if not validate_skill_path(skill_dir):
        return jsonify({"error": f"Invalid skill path: {name}"}), 400

    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    
    shutil.rmtree(skill_dir)
    with connect() as conn:
        conn.execute("DELETE FROM skill_files WHERE skill_version_id IN (SELECT id FROM skill_versions WHERE skill_id IN (SELECT id FROM skills WHERE name = ?))", (name,))
        conn.execute("DELETE FROM skill_versions WHERE skill_id IN (SELECT id FROM skills WHERE name = ?)", (name,))
        conn.execute("DELETE FROM skills WHERE name = ?", (name,))
    return jsonify({"success": True, "name": name})


@app.route('/api/status', methods=['GET'])
def api_status():
    cli_path = find_claude_cli()
    with connect() as conn:
        skill_count = conn.execute("SELECT COUNT(*) AS count FROM skills").fetchone()["count"]
        run_count = conn.execute("SELECT COUNT(*) AS count FROM runs").fetchone()["count"]
    return jsonify(
        {
            "status": "ok",
            "skills": skill_count,
            "runs": run_count,
            "claude_cli_available": bool(cli_path),
            "db_path": str(Path(os.environ.get("CREATION_STATION_DB_PATH", "creation_station.db")).resolve()),
        }
    )


@app.route('/api/skills/<name>/versions', methods=['GET'])
def list_skill_versions(name: str):
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    with connect() as conn:
        record = get_skill_record(conn, name)
        if not record:
            return jsonify({"error": f"Skill '{name}' not found"}), 404
        skill_id, current_version_id = record
        versions = [
            {
                "id": row["id"],
                "version_number": row["version_number"],
                "status": row["status"],
                "summary": row["summary"],
                "created_at": row["created_at"],
                "published_at": row["published_at"],
            }
            for row in fetch_skill_versions(conn, skill_id)
        ]
    return jsonify(
        {
            "skill": name,
            "current_published_version_id": current_version_id,
            "versions": versions,
        }
    )


@app.route('/api/skills/<name>/versions', methods=['POST'])
def create_skill_version(name: str):
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    data = request.json or {}
    files_data = data.get("files")
    summary = data.get("summary")
    status = data.get("status", "draft")
    with connect() as conn:
        skill_id = upsert_skill(conn, name)
        if files_data:
            files: list[SkillFile] = []
            for item in files_data:
                path = item.get("path")
                content = item.get("content", "")
                is_binary = bool(item.get("base64", False))
                if not path:
                    continue
                files.append(SkillFile(path=path, content=content, is_binary=is_binary))
        else:
            skill_dir = SKILLS_DIR / name
            # Validate the constructed path is within SKILLS_DIR
            if not validate_skill_path(skill_dir):
                return jsonify({"error": f"Invalid skill path: {name}"}), 400
            if not skill_dir.exists():
                return jsonify({"error": f"Skill '{name}' not found"}), 404
            files = load_skill_files(skill_dir)
        version_id = create_version(
            conn, skill_id=skill_id, files=files, status=status, summary=summary
        )
    return jsonify({"success": True, "skill": name, "version_id": version_id})


@app.route('/api/skills/<name>/publish', methods=['POST'])
def publish_skill_version(name: str):
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    data = request.json or {}
    version_id = data.get("version_id")
    if not version_id:
        return jsonify({"error": "version_id required"}), 400
    with connect() as conn:
        record = get_skill_record(conn, name)
        if not record:
            return jsonify({"error": f"Skill '{name}' not found"}), 404
        skill_id, _ = record
        skill_dir = SKILLS_DIR / name
        # Validate the constructed path is within SKILLS_DIR
        if not validate_skill_path(skill_dir):
            return jsonify({"error": f"Invalid skill path: {name}"}), 400
        skill_dir.mkdir(parents=True, exist_ok=True)
        write_version_to_filesystem(conn, int(version_id), skill_dir)
        publish_version(conn, skill_id, int(version_id))
    return jsonify({"success": True, "skill": name, "version_id": int(version_id)})


def lint_skill(content: str) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    suggestions: list[str] = []

    if "## Overview" not in content:
        errors.append("Missing required 'Overview' section.")
    if "## When to Use" not in content:
        errors.append("Missing required 'When to Use' section.")
    if "```" not in content:
        warnings.append("Add at least one example code block.")
    if "When NOT to use" not in content and "When Not to Use" not in content:
        suggestions.append("Consider adding a 'When NOT to use' section.")
    if "Failure" not in content and "Caveat" not in content:
        suggestions.append("Add failure modes or caveats to set expectations.")
    return {"errors": errors, "warnings": warnings, "suggestions": suggestions}


@app.route('/api/skills/<name>/validate', methods=['POST'])
def validate_skill(name: str):
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return jsonify({"error": f"Invalid skill name: {name}"}), 400

    data = request.json or {}
    content = data.get("content")
    if not content:
        skill_dir = SKILLS_DIR / name
        # Validate the constructed path is within SKILLS_DIR
        if not validate_skill_path(skill_dir):
            return jsonify({"error": f"Invalid skill path: {name}"}), 400
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            return jsonify({"error": f"Skill '{name}' not found"}), 404
        content = skill_file.read_text(encoding="utf-8")
    results = lint_skill(content)
    return jsonify(results)


@app.route('/api/runs', methods=['POST'])
def create_run():
    data = request.json or {}
    prompt = data.get("prompt_text", "").strip()
    if not prompt:
        return jsonify({"error": "prompt_text is required"}), 400
    runtime = data.get("runtime", "claude_cli")
    model_label = data.get("model_label", "claude-cli-default")
    selected_skills = data.get("selected_skills", [])
    settings = data.get("settings_json") or {}

    context, truncated = build_skill_context(selected_skills)
    if truncated:
        settings = {**settings, "context_truncated": True}

    created_at = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO runs (
                created_at, runtime, model_label, prompt_text, settings_json,
                selected_skills_json, status, started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                runtime,
                model_label,
                prompt,
                json.dumps(settings),
                json.dumps(selected_skills),
                "running",
                created_at,
            ),
        )
        run_id = int(cursor.lastrowid)

    cli_path = find_claude_cli()
    if runtime != "claude_cli":
        error_text = f"Unsupported runtime: {runtime}"
        with connect() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, error_text = ?, finished_at = ? WHERE id = ?",
                ("failed", error_text, utc_now(), run_id),
            )
        return jsonify({"run_id": run_id, "status": "failed", "error": error_text})
    if not cli_path:
        error_text = "Claude Code CLI not found"
        with connect() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, error_text = ?, finished_at = ? WHERE id = ?",
                ("failed", error_text, utc_now(), run_id),
            )
        return jsonify({"run_id": run_id, "status": "failed", "error": error_text}), 404

    full_prompt = f"Using this skill context:\n\n{context}\n\n{prompt}" if context else prompt
    started_at = datetime.now(timezone.utc)
    try:
        result = subprocess.run(
            [cli_path, "-p", full_prompt],
            capture_output=True,
            text=True,
            cwd=str(SKILLS_DIR),
            timeout=RUN_TIMEOUT_SECONDS,
        )
        finished_at = datetime.now(timezone.utc)
        latency_ms = int((finished_at - started_at).total_seconds() * 1000)
        output_text = result.stdout.strip()
        if len(output_text) > MAX_OUTPUT_CHARS:
            output_text = output_text[:MAX_OUTPUT_CHARS]
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO run_outputs (
                    run_id, output_text, stdout_text, stderr_text, return_code, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    output_text,
                    result.stdout,
                    result.stderr,
                    result.returncode,
                    utc_now(),
                ),
            )
            conn.execute(
                """
                UPDATE runs
                SET status = ?, finished_at = ?, latency_ms = ?
                WHERE id = ?
                """,
                ("succeeded", finished_at.isoformat(), latency_ms, run_id),
            )
        return jsonify({"run_id": run_id, "status": "succeeded", "output_text": output_text})
    except subprocess.TimeoutExpired:
        with connect() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, error_text = ?, finished_at = ? WHERE id = ?",
                ("failed", "Timeout", utc_now(), run_id),
            )
        return jsonify({"run_id": run_id, "status": "failed", "error": "Timeout"}), 408
    except Exception as exc:
        with connect() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, error_text = ?, finished_at = ? WHERE id = ?",
                ("failed", str(exc), utc_now(), run_id),
            )
        return jsonify({"run_id": run_id, "status": "failed", "error": str(exc)}), 500


@app.route('/api/runs/<int:run_id>', methods=['GET'])
def get_run(run_id: int):
    with connect() as conn:
        run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run_row:
            return jsonify({"error": "Run not found"}), 404
        output_row = conn.execute(
            "SELECT * FROM run_outputs WHERE run_id = ?", (run_id,)
        ).fetchone()
        feedback_rows = conn.execute(
            "SELECT * FROM feedback WHERE run_id = ? ORDER BY created_at DESC",
            (run_id,),
        ).fetchall()

    run_data = dict(run_row)
    run_data["settings_json"] = json.loads(run_data.get("settings_json") or "{}")
    run_data["selected_skills_json"] = json.loads(
        run_data.get("selected_skills_json") or "[]"
    )
    run_data["output"] = dict(output_row) if output_row else None
    run_data["feedback"] = [dict(row) for row in feedback_rows]
    return jsonify(run_data)


@app.route('/api/runs', methods=['GET'])
def list_runs():
    try:
        limit = int(request.args.get("limit", "25"))
    except ValueError:
        return jsonify({"error": "Invalid limit parameter"}), 400
    # Clamp limit to valid range (1-100)
    limit = max(1, min(limit, 100))
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return jsonify({"runs": [dict(row) for row in rows]})


@app.route('/api/runs/<int:run_id>/feedback', methods=['POST'])
def create_feedback(run_id: int):
    data = request.json or {}
    rating = data.get("rating")
    if not rating:
        return jsonify({"error": "rating is required"}), 400
    tags = data.get("tags", [])
    comment = data.get("comment", "")
    with connect() as conn:
        run_row = conn.execute("SELECT id FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run_row:
            return jsonify({"error": "Run not found"}), 404
        conn.execute(
            """
            INSERT INTO feedback (run_id, rating, tags_json, comment_text, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, rating, json.dumps(tags), comment, utc_now()),
        )
    return jsonify({"success": True})


@app.route('/api/runs/<int:run_id>/feedback', methods=['GET'])
def list_feedback(run_id: int):
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback WHERE run_id = ? ORDER BY created_at DESC",
            (run_id,),
        ).fetchall()
    return jsonify({"feedback": [dict(row) for row in rows]})


@app.route('/api/test-cases', methods=['POST'])
def create_test_case():
    data = request.json or {}
    title = data.get("title", "").strip()
    prompt_text = data.get("prompt_text", "").strip()
    if not title or not prompt_text:
        return jsonify({"error": "title and prompt_text are required"}), 400
    context_json = json.dumps(data.get("context_json") or {})
    expected_traits_json = json.dumps(data.get("expected_traits_json") or [])
    forbidden_traits_json = json.dumps(data.get("forbidden_traits_json") or [])
    rubric_json = json.dumps(data.get("rubric_json") or {})
    linked_skill_name = data.get("linked_skill_name")
    linked_skill_version_id = data.get("linked_skill_version_id")
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO test_cases (
                created_at, title, prompt_text, context_json, expected_traits_json,
                forbidden_traits_json, rubric_json, linked_skill_name, linked_skill_version_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                utc_now(),
                title,
                prompt_text,
                context_json,
                expected_traits_json,
                forbidden_traits_json,
                rubric_json,
                linked_skill_name,
                linked_skill_version_id,
            ),
        )
        test_case_id = int(cursor.lastrowid)
    return jsonify({"success": True, "test_case_id": test_case_id})


@app.route('/api/test-cases', methods=['GET'])
def list_test_cases():
    try:
        limit = int(request.args.get("limit", "50"))
    except ValueError:
        return jsonify({"error": "Invalid limit parameter"}), 400
    # Clamp limit to valid range (1-100)
    limit = max(1, min(limit, 100))
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM test_cases ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return jsonify({"test_cases": [dict(row) for row in rows]})


@app.route('/api/test-cases/from-run/<int:run_id>', methods=['POST'])
def create_test_case_from_run(run_id: int):
    data = request.json or {}
    title = data.get("title")
    with connect() as conn:
        run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run_row:
            return jsonify({"error": "Run not found"}), 404
    prompt_text = run_row["prompt_text"]
    context_json = json.dumps({"selected_skills": json.loads(run_row["selected_skills_json"] or "[]")})
    test_title = title or f"Run {run_id} test case"
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO test_cases (
                created_at, title, prompt_text, context_json,
                expected_traits_json, forbidden_traits_json, rubric_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                utc_now(),
                test_title,
                prompt_text,
                context_json,
                json.dumps(data.get("expected_traits_json") or []),
                json.dumps(data.get("forbidden_traits_json") or []),
                json.dumps(data.get("rubric_json") or {}),
            ),
        )
        test_case_id = int(cursor.lastrowid)
    return jsonify({"success": True, "test_case_id": test_case_id})

# ============ Import Folder/Files ============

@app.route('/api/import/folder', methods=['POST'])
def import_folder():
    """Import a skill from a folder path on disk."""
    data = request.json
    source_path = data.get("path", "")
    new_name = data.get("name", "")  # Optional rename
    
    if not source_path:
        return jsonify({"error": "Source path is required"}), 400
    
    source = Path(source_path)
    if not source.exists():
        return jsonify({"error": f"Path not found: {source_path}"}), 404
    
    if not source.is_dir():
        return jsonify({"error": "Path must be a directory"}), 400
    
    # Determine skill name
    skill_name = sanitize_name(new_name) if new_name else sanitize_name(source.name)
    dest = SKILLS_DIR / skill_name
    
    if dest.exists():
        return jsonify({"error": f"Skill '{skill_name}' already exists. Use overwrite option."}), 409
    
    try:
        # Copy entire directory
        shutil.copytree(source, dest)
        
        # Verify SKILL.md exists or create minimal one
        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            escaped_name = escape_yaml_value(skill_name)
            skill_md.write_text(f"---\nname: {escaped_name}\ndescription: Imported skill\n---\n\n# {skill_name}\n\nImported from {source_path}", encoding="utf-8")
        
        # Create _meta.json if missing
        meta_file = dest / "_meta.json"
        if not meta_file.exists():
            # Try to extract description from SKILL.md
            description = "Imported skill"
            content = skill_md.read_text(encoding="utf-8")
            if content.startswith("---"):
                try:
                    end = content.index("---", 3)
                    for line in content[3:end].split("\n"):
                        if line.startswith("description:"):
                            description = line.split(":", 1)[1].strip()
                            break
                except ValueError:
                    # Frontmatter not properly closed - use default description
                    pass
            
            meta = {
                "name": skill_name,
                "description": description,
                "tags": [],
                "sub_skills": [],
                "source": f"imported:{source_path}"
            }
            meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        
        file_count = len(list(dest.rglob("*")))
        version_id = snapshot_skill_to_db(skill_name, "Imported from folder")
        return jsonify({
            "success": True,
            "name": skill_name,
            "path": str(dest),
            "files_imported": file_count,
            "version_id": version_id
        })
        
    except Exception as e:
        # Cleanup on failure
        if dest.exists():
            shutil.rmtree(dest)
        return jsonify({"error": str(e)}), 500

@app.route('/api/import/files', methods=['POST'])
def import_files():
    """Import multiple files into a skill (multipart form data)."""
    skill_name = request.form.get("skill_name", "")

    if not skill_name:
        return jsonify({"error": "Skill name is required"}), 400

    # Check number of files
    if len(request.files) > MAX_FILES_PER_UPLOAD:
        return jsonify({"error": f"Too many files (max {MAX_FILES_PER_UPLOAD})"}), 400

    skill_name = sanitize_name(skill_name)
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)

    imported = []
    skipped = []
    total_size = 0

    for key in request.files:
        file = request.files[key]
        if not file.filename:
            continue

        # Validate file path
        is_valid, error_msg = validate_upload_path(file.filename)
        if not is_valid:
            skipped.append({"file": file.filename, "reason": error_msg})
            continue

        # Check file size (read content length if available)
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Seek back to beginning

        if file_size > MAX_FILE_SIZE_BYTES:
            skipped.append({"file": file.filename, "reason": f"File too large (max {MAX_FILE_SIZE_BYTES // (1024*1024)}MB)"})
            continue

        total_size += file_size
        if total_size > MAX_TOTAL_UPLOAD_BYTES:
            skipped.append({"file": file.filename, "reason": "Total upload size exceeded"})
            continue

        # Preserve relative path structure
        filename = file.filename.replace("\\", "/")
        dest_path = skill_dir / filename
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        file.save(str(dest_path))
        imported.append(filename)
    
    # Create _meta.json if it doesn't exist
    meta_file = skill_dir / "_meta.json"
    if not meta_file.exists():
        description = "Imported skill"
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            content = skill_md.read_text(encoding="utf-8")
            if content.startswith("---"):
                try:
                    end = content.index("---", 3)
                    for line in content[3:end].split("\n"):
                        if line.startswith("description:"):
                            description = line.split(":", 1)[1].strip()
                            break
                except ValueError:
                    # Frontmatter not properly closed - use default description
                    pass
        
        meta = {
            "name": skill_name,
            "description": description,
            "tags": [],
            "sub_skills": [],
            "source": "file-upload"
        }
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify({
        "success": True,
        "name": skill_name,
        "files_imported": imported,
        "files_skipped": skipped,
        "version_id": snapshot_skill_to_db(skill_name, "Imported files")
    })

@app.route('/api/import/json', methods=['POST'])
def import_files_json():
    """Import files via JSON with base64 content."""
    data = request.json
    skill_name = data.get("skill_name", "")
    files = data.get("files", [])  # [{path: "SKILL.md", content: "...", base64: false}, ...]

    if not skill_name:
        return jsonify({"error": "Skill name is required"}), 400

    # Check number of files
    if len(files) > MAX_FILES_PER_UPLOAD:
        return jsonify({"error": f"Too many files (max {MAX_FILES_PER_UPLOAD})"}), 400

    skill_name = sanitize_name(skill_name)
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)

    imported = []
    skipped = []
    total_size = 0

    for f in files:
        file_path = f.get("path", "")
        content = f.get("content", "")
        is_base64 = f.get("base64", False)

        # Validate file path
        is_valid, error_msg = validate_upload_path(file_path)
        if not is_valid:
            skipped.append({"file": file_path, "reason": error_msg})
            continue

        # Calculate content size
        if is_base64:
            # Base64 is ~4/3 the size of binary data
            content_size = len(content) * 3 // 4
        else:
            content_size = len(content.encode('utf-8'))

        if content_size > MAX_FILE_SIZE_BYTES:
            skipped.append({"file": file_path, "reason": f"File too large (max {MAX_FILE_SIZE_BYTES // (1024*1024)}MB)"})
            continue

        total_size += content_size
        if total_size > MAX_TOTAL_UPLOAD_BYTES:
            skipped.append({"file": file_path, "reason": "Total upload size exceeded"})
            continue

        dest_path = skill_dir / file_path.replace("\\", "/")
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if is_base64:
                dest_path.write_bytes(base64.b64decode(content))
            else:
                dest_path.write_text(content, encoding="utf-8")
            imported.append(file_path)
        except (ValueError, binascii.Error) as e:
            skipped.append({"file": file_path, "reason": f"Invalid base64: {e}"})
    
    # Create _meta.json if missing
    meta_file = skill_dir / "_meta.json"
    if not meta_file.exists() and "SKILL.md" in imported:
        skill_md = skill_dir / "SKILL.md"
        content = skill_md.read_text(encoding="utf-8")
        description = "Imported skill"
        if content.startswith("---"):
            try:
                end = content.index("---", 3)
                for line in content[3:end].split("\n"):
                    if line.startswith("description:"):
                        description = line.split(":", 1)[1].strip()
                        break
            except ValueError:
                # Frontmatter not properly closed - use default description
                pass
        
        meta = {"name": skill_name, "description": description, "tags": [], "sub_skills": [], "source": "json-upload"}
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify(
        {
            "success": True,
            "name": skill_name,
            "files_imported": imported,
            "files_skipped": skipped,
            "version_id": snapshot_skill_to_db(skill_name, "Imported JSON files"),
        }
    )

@app.route('/api/browse', methods=['GET'])
def browse_filesystem():
    """Browse filesystem to select folders for import."""
    path = request.args.get("path", "")
    
    if not path:
        # Return drives on Windows, root on Unix
        if os.name == 'nt':
            import string
            drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
            return jsonify({"path": "", "dirs": drives, "files": []})
        else:
            path = "/"
    
    p = Path(path)
    if not p.exists():
        return jsonify({"error": f"Path not found: {path}"}), 404
    
    dirs = []
    files = []
    
    try:
        for item in sorted(p.iterdir()):
            if item.name.startswith('.'):
                continue
            if item.is_dir():
                # Check if it looks like a skill folder
                is_skill = (item / "SKILL.md").exists()
                dirs.append({"name": item.name, "path": str(item), "is_skill": is_skill})
            else:
                files.append({"name": item.name, "path": str(item)})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    
    return jsonify({
        "path": str(p),
        "parent": str(p.parent) if p.parent != p else None,
        "dirs": dirs[:100],  # Limit results
        "files": files[:100]
    })

# ============ Claude Code CLI Integration ============

@app.route('/api/claude/status', methods=['GET'])
def claude_status():
    cli_path = find_claude_cli()
    if cli_path:
        try:
            result = subprocess.run([cli_path, '--version'], capture_output=True, text=True, timeout=5)
            return jsonify({"available": True, "path": cli_path, "version": result.stdout.strip() or result.stderr.strip()})
        except Exception as e:
            return jsonify({"available": False, "error": str(e)})
    return jsonify({"available": False, "error": "Claude Code CLI not found"})

@app.route('/api/claude/run', methods=['POST'])
def claude_run():
    data = request.json
    prompt = data.get("prompt", "")
    skill_context = data.get("skill_context", "")
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    full_prompt = f"Using this skill context:\n\n{skill_context}\n\n{prompt}" if skill_context else prompt
    
    try:
        result = subprocess.run([cli_path, '-p', full_prompt], capture_output=True, text=True, cwd=str(SKILLS_DIR), timeout=120)
        return jsonify({"success": True, "stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/claude/generate-skill', methods=['POST'])
def claude_generate_skill():
    data = request.json
    skill_idea = data.get("idea", "")
    
    if not skill_idea:
        return jsonify({"error": "Skill idea required"}), 400
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    prompt = f"""Generate a Claude skill based on this idea: {skill_idea}

Output a complete SKILL.md file in this exact format:

---
name: skill-name-here
description: One line description
---

# Skill Name

## Overview
Detailed description.

## When to Use
- Trigger 1
- Trigger 2

## Quick Start
```code
Example
```

## Best Practices
- Practice 1

Only output the SKILL.md content."""

    try:
        result = subprocess.run([cli_path, '-p', prompt, '--output-format', 'text'], capture_output=True, text=True, timeout=180)
        output = result.stdout.strip()
        skill_data = {"content": output}
        
        if output.startswith("---"):
            try:
                end = output.index("---", 3)
                for line in output[3:end].split("\n"):
                    if line.startswith("name:"): skill_data["name"] = line.split(":", 1)[1].strip()
                    elif line.startswith("description:"): skill_data["description"] = line.split(":", 1)[1].strip()
            except ValueError:
                # Frontmatter not properly closed - continue without extracting name/description
                pass
        
        return jsonify({"success": True, "skill": skill_data})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/claude/improve-skill', methods=['POST'])
def claude_improve_skill():
    data = request.json
    skill_name = data.get("skill_name", "")
    improvement_request = data.get("request", "")

    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(skill_name):
        return jsonify({"error": f"Invalid skill name: {skill_name}"}), 400

    skill_dir = SKILLS_DIR / skill_name
    # Validate the constructed path is within SKILLS_DIR
    if not validate_skill_path(skill_dir):
        return jsonify({"error": f"Invalid skill path: {skill_name}"}), 400

    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return jsonify({"error": f"Skill '{skill_name}' not found"}), 404
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    current_content = skill_file.read_text(encoding="utf-8")
    prompt = f"""Improve this skill: {improvement_request}

Current SKILL.md:
{current_content}

Output the complete improved SKILL.md file only."""

    try:
        result = subprocess.run([cli_path, '-p', prompt, '--output-format', 'text'], capture_output=True, text=True, timeout=180)
        return jsonify({"success": True, "improved_content": result.stdout.strip(), "original_content": current_content})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reload', methods=['POST'])
def reload_index():
    return jsonify({"success": True, "message": "Skills reloaded"})

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           Skills Manager API + Claude Code CLI               ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:5050                           ║
║  Skills:     {str(SKILLS_DIR):<44} ║
║  Claude CLI: {str(find_claude_cli() or 'Not found'):<44} ║
╚══════════════════════════════════════════════════════════════╝
""")
    app.run(port=5050, debug=True)
