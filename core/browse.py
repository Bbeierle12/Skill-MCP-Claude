# core/browse.py
# RESTRICTED filesystem browser - ONLY allows browsing within skills/ directory
# This is a SECURITY-CRITICAL module

from pathlib import Path
from typing import Any

from .config import get_skills_dir


def browse_skills_directory(relative_path: str = "") -> tuple[dict[str, Any] | None, str | None]:
    """
    Browse the skills directory ONLY.

    SECURITY: This function is intentionally restricted to only allow browsing
    within the skills/ directory. It will NOT expose the rest of the filesystem.

    Args:
        relative_path: Path relative to skills directory (e.g., "my-skill/scripts")
                       Empty string means root of skills directory.

    Returns:
        Tuple of (result_data, error_message)
    """
    skills_dir = get_skills_dir()

    # Resolve the target path
    if relative_path:
        # Normalize path separators
        relative_path = relative_path.replace("\\", "/")

        # SECURITY: Prevent path traversal attacks
        if ".." in relative_path:
            return None, "Path traversal not allowed"

        target_path = skills_dir / relative_path
    else:
        target_path = skills_dir

    # SECURITY: Ensure the resolved path is still within skills directory
    try:
        # resolve() will follow symlinks and normalize the path
        resolved_target = target_path.resolve()
        resolved_skills = skills_dir.resolve()

        # Check that target is within or equal to skills directory
        if not (resolved_target == resolved_skills or
                str(resolved_target).startswith(str(resolved_skills) + "/" ) or
                str(resolved_target).startswith(str(resolved_skills) + "\\")):
            return None, "Access denied: Path outside skills directory"
    except (OSError, ValueError):
        return None, "Invalid path"

    if not target_path.exists():
        return None, f"Path not found: {relative_path or '(root)'}"

    if not target_path.is_dir():
        return None, "Path is not a directory"

    dirs = []
    files = []

    try:
        for item in sorted(target_path.iterdir()):
            # Skip hidden files
            if item.name.startswith('.'):
                continue

            # Get path relative to skills directory
            rel_path = str(item.relative_to(skills_dir))

            if item.is_dir():
                # Check if it looks like a skill folder
                is_skill = (item / "SKILL.md").exists()
                dirs.append({
                    "name": item.name,
                    "path": rel_path,
                    "is_skill": is_skill,
                })
            else:
                files.append({
                    "name": item.name,
                    "path": rel_path,
                })
    except PermissionError:
        return None, "Permission denied"

    # Calculate parent path (only if we're not at root)
    parent = None
    if relative_path:
        parent_path = Path(relative_path).parent
        if parent_path != Path("."):
            parent = str(parent_path)
        else:
            parent = ""  # Empty string means root

    return {
        "path": relative_path or "",
        "parent": parent,
        "dirs": dirs[:100],  # Limit results
        "files": files[:100],
        "restricted": True,  # Flag indicating this is the restricted browser
        "base_dir": "skills/",  # Inform client of the base directory
    }, None
