# server.py
from fastmcp import FastMCP
from pathlib import Path
from datetime import datetime
from threading import Thread, Lock
import json
import re
import time
import logging
from collections import deque

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("skills-server")

mcp = FastMCP("skills-server")
SKILLS_DIR = Path(__file__).parent / "skills"

# Ensure skills directory exists
if not SKILLS_DIR.exists():
    logger.warning(f"Skills directory not found, creating: {SKILLS_DIR}")
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)

_INDEX = None
_CONTENT_INDEX = None  # Full-text search index
_FILE_MTIMES = {}  # For file watching
_USAGE_STATS = {
    "tool_calls": {},
    "skill_loads": {},
    "searches": deque(maxlen=100),  # Use deque for efficient size limiting
    "start_time": datetime.now().isoformat()
}

# Thread synchronization locks
_INDEX_LOCK = Lock()
_CONTENT_INDEX_LOCK = Lock()
_FILE_MTIMES_LOCK = Lock()
_STATS_LOCK = Lock()

# Schema for _meta.json validation
META_SCHEMA = {
    "required": ["name", "description"],
    "optional": ["tags", "sub_skills"],
    "sub_skill_schema": {
        "required": ["name", "file"],
        "optional": ["triggers"]
    }
}


def is_safe_skill_name(name: str) -> bool:
    """Validate that a skill name is safe for filesystem operations."""
    if not name or not isinstance(name, str):
        return False
    # Only allow alphanumeric, hyphens, and underscores
    return bool(re.match(r'^[a-zA-Z0-9\-_]+$', name))


def validate_skill_path(skill_path: Path) -> bool:
    """Validate that a resolved path is within SKILLS_DIR."""
    try:
        resolved_path = skill_path.resolve()
        skills_dir_resolved = SKILLS_DIR.resolve()
        return str(resolved_path).startswith(str(skills_dir_resolved))
    except (OSError, ValueError):
        return False


def validate_meta(meta: dict, skill_name: str) -> list[str]:
    """Validate _meta.json against schema. Returns list of errors."""
    errors = []

    for field in META_SCHEMA["required"]:
        if field not in meta:
            errors.append(f"{skill_name}: Missing required field '{field}'")

    if "name" in meta and meta["name"] != skill_name:
        errors.append(f"{skill_name}: 'name' field ({meta['name']}) doesn't match directory name")

    if "tags" in meta:
        if not isinstance(meta["tags"], list):
            errors.append(f"{skill_name}: 'tags' must be a list")
        elif not all(isinstance(t, str) for t in meta["tags"]):
            errors.append(f"{skill_name}: All tags must be strings")

    if "sub_skills" in meta:
        if not isinstance(meta["sub_skills"], list):
            errors.append(f"{skill_name}: 'sub_skills' must be a list")
        else:
            for i, sub in enumerate(meta["sub_skills"]):
                for field in META_SCHEMA["sub_skill_schema"]["required"]:
                    if field not in sub:
                        errors.append(f"{skill_name}: sub_skill[{i}] missing required field '{field}'")

    return errors


def build_content_index() -> dict:
    """Build full-text search index from skill content."""
    index = {}

    if not SKILLS_DIR.exists():
        logger.warning(f"Skills directory does not exist: {SKILLS_DIR}")
        return index

    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue

        skill_name = skill_dir.name

        # Index SKILL.md
        skill_file = skill_dir / "SKILL.md"
        if skill_file.exists():
            try:
                content = skill_file.read_text(encoding="utf-8", errors="ignore").lower()
                index[f"{skill_name}:SKILL.md"] = {
                    "domain": skill_name,
                    "sub_skill": None,
                    "file": "SKILL.md",
                    "content": content
                }
            except (OSError, UnicodeDecodeError) as e:
                logger.warning(f"Failed to read {skill_file}: {e}")

        # Index references
        refs_dir = skill_dir / "references"
        if refs_dir.exists():
            for ref_file in refs_dir.glob("*.md"):
                try:
                    content = ref_file.read_text(encoding="utf-8", errors="ignore").lower()
                    index[f"{skill_name}:references/{ref_file.name}"] = {
                        "domain": skill_name,
                        "sub_skill": ref_file.stem,
                        "file": f"references/{ref_file.name}",
                        "content": content
                    }
                except (OSError, UnicodeDecodeError) as e:
                    logger.warning(f"Failed to read {ref_file}: {e}")

        # Index scripts
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.exists():
            for script_file in scripts_dir.glob("*.md"):
                try:
                    content = script_file.read_text(encoding="utf-8", errors="ignore").lower()
                    index[f"{skill_name}:scripts/{script_file.name}"] = {
                        "domain": skill_name,
                        "sub_skill": script_file.stem.replace('.js', '').replace('.ts', ''),
                        "file": f"scripts/{script_file.name}",
                        "content": content
                    }
                except (OSError, UnicodeDecodeError) as e:
                    logger.warning(f"Failed to read {script_file}: {e}")

    return index


def load_index() -> dict:
    """Load or rebuild skill index from _meta.json files."""
    global _CONTENT_INDEX

    index = {"skills": [], "validation_errors": []}

    if not SKILLS_DIR.exists():
        logger.error(f"Skills directory does not exist: {SKILLS_DIR}")
        return index

    for skill_dir in SKILLS_DIR.iterdir():
        if skill_dir.is_dir():
            meta_file = skill_dir / "_meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))

                    # Validate schema
                    errors = validate_meta(meta, skill_dir.name)
                    if errors:
                        index["validation_errors"].extend(errors)
                        logger.warning(f"Validation errors in {skill_dir.name}: {errors}")

                    index["skills"].append(meta)
                except json.JSONDecodeError as e:
                    error = f"{skill_dir.name}: Invalid JSON in _meta.json: {e}"
                    index["validation_errors"].append(error)
                    logger.error(error)
                except (OSError, UnicodeDecodeError) as e:
                    error = f"{skill_dir.name}: Failed to read _meta.json: {e}"
                    index["validation_errors"].append(error)
                    logger.error(error)

    # Build content index for full-text search
    with _CONTENT_INDEX_LOCK:
        _CONTENT_INDEX = build_content_index()
    logger.info(f"Loaded {len(index['skills'])} skills, indexed {len(_CONTENT_INDEX)} files")

    return index


def get_index() -> dict:
    """Get the current index, reloading if needed."""
    global _INDEX
    with _INDEX_LOCK:
        if _INDEX is None:
            _INDEX = load_index()
        return _INDEX


def track_usage(tool_name: str, details: dict = None):
    """Track tool usage for metrics."""
    with _STATS_LOCK:
        if tool_name not in _USAGE_STATS["tool_calls"]:
            _USAGE_STATS["tool_calls"][tool_name] = 0
        _USAGE_STATS["tool_calls"][tool_name] += 1

        if details:
            if "domain" in details:
                domain = details["domain"]
                if domain not in _USAGE_STATS["skill_loads"]:
                    _USAGE_STATS["skill_loads"][domain] = 0
                _USAGE_STATS["skill_loads"][domain] += 1

            if "query" in details:
                _USAGE_STATS["searches"].append({
                    "query": details["query"],
                    "timestamp": datetime.now().isoformat()
                })
                # Deque automatically limits to maxlen=100


def check_for_changes() -> bool:
    """Check if any skill files have changed."""
    global _FILE_MTIMES

    changed = False
    current_mtimes = {}

    if not SKILLS_DIR.exists():
        return False

    with _FILE_MTIMES_LOCK:
        for skill_dir in SKILLS_DIR.iterdir():
            if not skill_dir.is_dir():
                continue

            for file in skill_dir.rglob("*"):
                if file.is_file():
                    try:
                        mtime = file.stat().st_mtime
                        current_mtimes[str(file)] = mtime

                        if str(file) in _FILE_MTIMES:
                            if _FILE_MTIMES[str(file)] != mtime:
                                changed = True
                                logger.info(f"File changed: {file}")
                        else:
                            # New file
                            changed = True
                    except (OSError, PermissionError) as e:
                        logger.warning(f"Cannot access {file}: {e}")
                        continue

        # Check for deleted files
        for old_file in _FILE_MTIMES:
            if old_file not in current_mtimes:
                changed = True
                logger.info(f"File deleted: {old_file}")

        _FILE_MTIMES = current_mtimes

    return changed


def file_watcher():
    """Background thread to watch for file changes."""
    global _INDEX

    logger.info("File watcher started")
    while True:
        try:
            if check_for_changes():
                logger.info("Changes detected, reloading index...")
                new_index = load_index()
                with _INDEX_LOCK:
                    _INDEX = new_index
        except Exception as e:
            logger.error(f"File watcher error: {e}")

        time.sleep(5)  # Check every 5 seconds


# Start file watcher in background
_watcher_thread = Thread(target=file_watcher, daemon=True)
_watcher_thread.start()


# Core functions (testable without MCP)
def _list_skills() -> dict:
    """List all available skill domains with descriptions."""
    track_usage("list_skills")
    index = get_index()
    return {
        "skills": [
            {
                "name": s["name"],
                "description": s["description"],
                "sub_skills": [sub["name"] for sub in s.get("sub_skills", [])]
            }
            for s in index["skills"]
        ]
    }


def _get_skill(name: str) -> dict:
    """Load a skill's main SKILL.md content."""
    # Validate skill name to prevent path traversal
    if not is_safe_skill_name(name):
        return {"error": f"Invalid skill name: {name}"}
    
    track_usage("get_skill", {"domain": name})

    skill_dir = SKILLS_DIR / name
    
    # Validate resolved path is within SKILLS_DIR
    if not validate_skill_path(skill_dir):
        return {"error": f"Invalid skill path: {name}"}
    
    skill_file = skill_dir / "SKILL.md"

    if not skill_file.exists():
        return {"error": f"Skill '{name}' not found"}

    try:
        content = skill_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        logger.error(f"Failed to read skill {name}: {e}")
        return {"error": f"Failed to read skill: {e}"}

    index = get_index()
    meta = next((s for s in index["skills"] if s["name"] == name), {})

    return {
        "name": name,
        "content": content,
        "sub_skills": [sub["name"] for sub in meta.get("sub_skills", [])],
        "has_references": (skill_dir / "references").exists()
    }


def _get_sub_skill(domain: str, sub_skill: str) -> dict:
    """Load a specific sub-skill's content from a domain."""
    # Validate domain name
    if not is_safe_skill_name(domain):
        return {"error": f"Invalid domain name: {domain}"}
    
    track_usage("get_sub_skill", {"domain": domain, "sub_skill": sub_skill})

    index = get_index()
    meta = next((s for s in index["skills"] if s["name"] == domain), None)
    if not meta:
        return {"error": f"Domain '{domain}' not found"}

    sub = next((s for s in meta.get("sub_skills", []) if s["name"] == sub_skill), None)
    if not sub:
        return {"error": f"Sub-skill '{sub_skill}' not found in '{domain}'"}

    file_path = SKILLS_DIR / domain / sub["file"]
    
    # Validate resolved path is within SKILLS_DIR
    if not validate_skill_path(file_path):
        logger.warning(f"Path traversal attempt detected: domain={domain}, file={sub['file']}")
        return {"error": f"Invalid file path"}
    
    if not file_path.exists():
        return {"error": f"File not found: {sub['file']}"}

    try:
        content = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        logger.error(f"Failed to read sub-skill {domain}/{sub_skill}: {e}")
        return {"error": f"Failed to read sub-skill: {e}"}

    return {
        "domain": domain,
        "sub_skill": sub_skill,
        "content": content
    }


def _get_skills_batch(requests: list[dict]) -> dict:
    """Load multiple skills/sub-skills in a single request."""
    track_usage("get_skills_batch")

    results = []
    for req in requests:
        domain = req.get("domain")
        sub_skill = req.get("sub_skill")

        if sub_skill:
            results.append(_get_sub_skill(domain, sub_skill))
        else:
            results.append(_get_skill(domain))

    return {"results": results}


def _search_skills(query: str, limit: int = 5) -> dict:
    """Search skills by keyword/phrase."""
    # Validate query
    if not query or not query.strip():
        return {"error": "Query cannot be empty", "results": []}
    
    if len(query) > 1000:
        return {"error": "Query too long (max 1000 characters)", "results": []}
    
    # Clamp limit to reasonable bounds
    limit = max(1, min(limit, 100))
    
    track_usage("search_skills", {"query": query})

    query_lower = query.lower()
    results = []
    index = get_index()

    for skill in index["skills"]:
        # Check domain-level matches
        score = 0
        match_type = None

        if query_lower in skill["name"].lower():
            score = 0.9
            match_type = "name"
        elif query_lower in skill["description"].lower():
            score = 0.7
            match_type = "description"
        elif any(query_lower in tag.lower() for tag in skill.get("tags", [])):
            score = 0.8
            match_type = "tags"

        if score > 0:
            results.append({
                "domain": skill["name"],
                "sub_skill": None,
                "score": score,
                "match": match_type
            })

        # Check sub-skill matches
        for sub in skill.get("sub_skills", []):
            sub_score = 0
            sub_match = None

            if query_lower in sub["name"].lower():
                sub_score = 0.85
                sub_match = "name"
            elif any(query_lower in t.lower() for t in sub.get("triggers", [])):
                sub_score = 0.9
                sub_match = "triggers"

            if sub_score > 0:
                results.append({
                    "domain": skill["name"],
                    "sub_skill": sub["name"],
                    "score": sub_score,
                    "match": sub_match
                })

    results.sort(key=lambda x: x["score"], reverse=True)
    return {"query": query, "results": results[:limit]}


def _search_content(query: str, limit: int = 10) -> dict:
    """Full-text search across all skill content."""
    # Validate query
    if not query or not query.strip():
        return {"error": "Query cannot be empty", "results": []}
    
    if len(query) > 1000:
        return {"error": "Query too long (max 1000 characters)", "results": []}
    
    query_words = query.lower().split()
    if len(query_words) > 100:
        return {"error": "Too many search terms (max 100 words)", "results": []}
    
    # Clamp limit to reasonable bounds
    limit = max(1, min(limit, 100))
    
    track_usage("search_content", {"query": query})

    with _CONTENT_INDEX_LOCK:
        if _CONTENT_INDEX is None:
            get_index()  # Ensure index is loaded

        query_lower = query.lower()
        results = []

        for key, entry in _CONTENT_INDEX.items():
            content = entry["content"]

            # Calculate relevance score
            score = 0

            # Exact phrase match (highest priority)
            if query_lower in content:
                score = 1.0
                # Boost for matches in first 500 chars (likely headings/intro)
                if query_lower in content[:500]:
                    score = 1.2

            # All words present (medium priority)
            elif all(word in content for word in query_words):
                score = 0.7
                matches = sum(content.count(word) for word in query_words)
                score += min(matches * 0.05, 0.2)  # Bonus for frequency, capped

            # Some words present (lower priority)
            else:
                matches = sum(1 for word in query_words if word in content)
                if matches > 0:
                    score = 0.3 * (matches / len(query_words))

            if score > 0:
                # Extract snippet around match
                snippet = extract_snippet(content, query_lower, 150)

                results.append({
                    "domain": entry["domain"],
                    "sub_skill": entry["sub_skill"],
                    "file": entry["file"],
                    "score": round(score, 3),
                    "snippet": snippet
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return {"query": query, "results": results[:limit]}


def extract_snippet(content: str, query: str, max_length: int = 150) -> str:
    """Extract a snippet around the query match."""
    pos = content.find(query)
    if pos == -1:
        # Try finding first query word
        for word in query.split():
            pos = content.find(word)
            if pos != -1:
                break

    if pos == -1:
        return content[:max_length] + "..."

    start = max(0, pos - 50)
    end = min(len(content), pos + max_length)

    snippet = content[start:end]

    if start > 0:
        snippet = "..." + snippet
    if end < len(content):
        snippet = snippet + "..."

    return snippet.replace('\n', ' ').strip()


def _reload_index() -> dict:
    """Reload the skill index from disk."""
    global _INDEX
    new_index = load_index()
    with _INDEX_LOCK:
        _INDEX = new_index
    track_usage("reload_index")
    
    with _CONTENT_INDEX_LOCK:
        content_count = len(_CONTENT_INDEX) if _CONTENT_INDEX else 0
    
    return {
        "status": "reloaded",
        "skill_count": len(_INDEX["skills"]),
        "content_files_indexed": content_count,
        "validation_errors": _INDEX.get("validation_errors", [])
    }


def _get_stats() -> dict:
    """Get usage statistics."""
    # Acquire locks in consistent order to avoid deadlock
    with _STATS_LOCK:
        stats_copy = {
            "uptime_since": _USAGE_STATS["start_time"],
            "tool_calls": _USAGE_STATS["tool_calls"].copy(),
            "skill_loads": _USAGE_STATS["skill_loads"].copy(),
            "recent_searches": list(_USAGE_STATS["searches"])[-10:],  # Last 10 searches
        }
    
    # Get index info without holding stats lock
    index = get_index()
    stats_copy["total_skills"] = len(index["skills"])
    
    with _CONTENT_INDEX_LOCK:
        stats_copy["content_files_indexed"] = len(_CONTENT_INDEX) if _CONTENT_INDEX else 0
    
    return stats_copy


def _validate_skills() -> dict:
    """Validate all skill metadata."""
    errors = []
    warnings = []

    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue

        skill_name = skill_dir.name
        meta_file = skill_dir / "_meta.json"
        skill_file = skill_dir / "SKILL.md"

        # Check required files
        if not meta_file.exists():
            errors.append(f"{skill_name}: Missing _meta.json")
            continue

        if not skill_file.exists():
            errors.append(f"{skill_name}: Missing SKILL.md")

        # Validate meta
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            meta_errors = validate_meta(meta, skill_name)
            errors.extend(meta_errors)

            # Check sub-skill files exist
            for sub in meta.get("sub_skills", []):
                sub_file = skill_dir / sub["file"]
                if not sub_file.exists():
                    errors.append(f"{skill_name}: Sub-skill file not found: {sub['file']}")

            # Warnings for potential issues
            if not meta.get("tags"):
                warnings.append(f"{skill_name}: No tags defined")

            if not meta.get("sub_skills"):
                warnings.append(f"{skill_name}: No sub-skills defined (standalone skill)")

        except json.JSONDecodeError as e:
            errors.append(f"{skill_name}: Invalid JSON in _meta.json: {e}")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "skills_checked": sum(1 for d in SKILLS_DIR.iterdir() if d.is_dir())
    }


# MCP Tool wrappers
@mcp.tool()
def list_skills() -> dict:
    """
    List all available skill domains with descriptions.
    Use this to understand what skills exist before loading specific content.
    Returns domain names, descriptions, and available sub-skills.
    """
    return _list_skills()


@mcp.tool()
def get_skill(name: str) -> dict:
    """
    Load a skill's main SKILL.md content.
    For domain skills with sub-skills, this returns the router/overview.

    Args:
        name: Skill domain name (e.g., "forms", "building", "component-library")
    """
    return _get_skill(name)


@mcp.tool()
def get_sub_skill(domain: str, sub_skill: str) -> dict:
    """
    Load a specific sub-skill's content from a domain.

    Args:
        domain: Parent skill domain (e.g., "forms")
        sub_skill: Sub-skill name (e.g., "validation", "react")
    """
    return _get_sub_skill(domain, sub_skill)


@mcp.tool()
def get_skills_batch(requests: list[dict]) -> dict:
    """
    Load multiple skills/sub-skills in a single request.

    Args:
        requests: List of {"domain": str, "sub_skill": str | None}
                  If sub_skill is None, loads main SKILL.md

    Example:
        [
            {"domain": "forms", "sub_skill": None},
            {"domain": "forms", "sub_skill": "react"},
            {"domain": "forms", "sub_skill": "validation"}
        ]
    """
    return _get_skills_batch(requests)


@mcp.tool()
def search_skills(query: str, limit: int = 5) -> dict:
    """
    Search skills by keyword/phrase. Searches names, descriptions,
    tags, and trigger words.

    Args:
        query: Search term (e.g., "zod validation", "multiplayer sync")
        limit: Max results to return
    """
    return _search_skills(query, limit)


@mcp.tool()
def search_content(query: str, limit: int = 10) -> dict:
    """
    Full-text search across all skill content.
    Searches the actual markdown content of skills and sub-skills.
    Returns snippets showing where matches were found.

    Args:
        query: Search term or phrase (e.g., "useForm hook", "delta compression")
        limit: Max results to return (default 10)
    """
    return _search_content(query, limit)


@mcp.tool()
def reload_index() -> dict:
    """
    Reload the skill index from disk.
    Use this after adding or modifying skill files.
    Also rebuilds the full-text search index.
    """
    return _reload_index()


@mcp.tool()
def get_stats() -> dict:
    """
    Get usage statistics for the skills server.
    Shows which skills are most used, recent searches, and uptime.
    """
    return _get_stats()


@mcp.tool()
def validate_skills() -> dict:
    """
    Validate all skill metadata and file structure.
    Checks for missing files, invalid JSON, and schema violations.
    Returns errors and warnings.
    """
    return _validate_skills()


if __name__ == "__main__":
    mcp.run()
