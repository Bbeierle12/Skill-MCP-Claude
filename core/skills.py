# core/skills.py
# Skills CRUD operations

import json
import shutil
import base64
from pathlib import Path
from typing import Any

from .config import get_skills_dir
from .utils import sanitize_name, extract_description_from_frontmatter, create_skill_markdown


def list_all_skills() -> list[dict[str, Any]]:
    """List all skills with their metadata."""
    skills_dir = get_skills_dir()
    skills = []

    if not skills_dir.exists():
        return skills

    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue

        skill_data = {"name": skill_dir.name}

        # Load metadata from _meta.json
        meta_file = skill_dir / "_meta.json"
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                skill_data.update(meta)
            except (json.JSONDecodeError, OSError):
                pass  # Skip invalid metadata

        # Load content from SKILL.md
        skill_file = skill_dir / "SKILL.md"
        if skill_file.exists():
            try:
                content = skill_file.read_text(encoding="utf-8")
                skill_data["content"] = content

                # Extract description if not in metadata
                if "description" not in skill_data:
                    desc = extract_description_from_frontmatter(content)
                    if desc:
                        skill_data["description"] = desc
            except OSError:
                pass

        # Add file structure info
        skill_data["has_scripts"] = (skill_dir / "scripts").exists()
        skill_data["has_references"] = (skill_dir / "references").exists()
        skill_data["file_count"] = len(list(skill_dir.rglob("*")))

        skills.append(skill_data)

    return skills


def get_skill_by_name(name: str) -> tuple[dict[str, Any] | None, str | None]:
    """
    Get a specific skill's details including all files.

    Returns:
        Tuple of (skill_data, error_message)
    """
    skills_dir = get_skills_dir()
    skill_dir = skills_dir / name

    if not skill_dir.exists():
        return None, f"Skill '{name}' not found"

    skill_data = {"name": name, "files": []}

    # Load metadata
    meta_file = skill_dir / "_meta.json"
    if meta_file.exists():
        try:
            skill_data.update(json.loads(meta_file.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass

    # Load content
    skill_file = skill_dir / "SKILL.md"
    if skill_file.exists():
        try:
            skill_data["content"] = skill_file.read_text(encoding="utf-8")
        except OSError:
            pass

    # List all files
    for f in skill_dir.rglob("*"):
        if f.is_file():
            skill_data["files"].append(str(f.relative_to(skill_dir)))

    return skill_data, None


def create_skill(
    name: str,
    description: str = "",
    content: str = "",
    tags: list[str] | None = None,
    sub_skills: list[str] | None = None,
    overwrite: bool = False,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Create a new skill.

    Returns:
        Tuple of (result_data, error_message)
    """
    name = sanitize_name(name)
    if not name:
        return None, "Skill name is required"

    skills_dir = get_skills_dir()
    skill_dir = skills_dir / name

    if skill_dir.exists() and not overwrite:
        return None, f"Skill '{name}' already exists"

    skill_dir.mkdir(parents=True, exist_ok=True)

    # Write SKILL.md
    skill_md = create_skill_markdown(name, description, content)
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    # Write _meta.json
    meta = {
        "name": name,
        "description": description,
        "tags": tags or [],
        "sub_skills": sub_skills or [],
        "source": "created",
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return {"success": True, "name": name, "path": str(skill_dir)}, None


def update_skill(
    name: str,
    description: str = "",
    content: str = "",
    tags: list[str] | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Update an existing skill.

    Returns:
        Tuple of (result_data, error_message)
    """
    skills_dir = get_skills_dir()
    skill_dir = skills_dir / name

    if not skill_dir.exists():
        return None, f"Skill '{name}' not found"

    # Write updated SKILL.md
    skill_md = create_skill_markdown(name, description, content)
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    # Update _meta.json
    meta_file = skill_dir / "_meta.json"
    meta = {}
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    meta.update({
        "name": name,
        "description": description,
        "tags": tags if tags is not None else meta.get("tags", []),
    })
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return {"success": True, "name": name}, None


def delete_skill(name: str) -> tuple[dict[str, Any] | None, str | None]:
    """
    Delete a skill.

    Returns:
        Tuple of (result_data, error_message)
    """
    skills_dir = get_skills_dir()
    skill_dir = skills_dir / name

    if not skill_dir.exists():
        return None, f"Skill '{name}' not found"

    shutil.rmtree(skill_dir)
    return {"success": True, "name": name}, None


def import_folder(
    source_path: str,
    new_name: str = "",
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Import a skill from a folder path on disk.

    Returns:
        Tuple of (result_data, error_message)
    """
    if not source_path:
        return None, "Source path is required"

    source = Path(source_path)
    if not source.exists():
        return None, f"Path not found: {source_path}"

    if not source.is_dir():
        return None, "Path must be a directory"

    # Determine skill name
    skill_name = sanitize_name(new_name) if new_name else sanitize_name(source.name)
    skills_dir = get_skills_dir()
    dest = skills_dir / skill_name

    if dest.exists():
        return None, f"Skill '{skill_name}' already exists. Use overwrite option."

    try:
        # Copy entire directory
        shutil.copytree(source, dest)

        # Verify SKILL.md exists or create minimal one
        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            skill_md.write_text(
                create_skill_markdown(skill_name, "Imported skill", f"# {skill_name}\n\nImported skill."),
                encoding="utf-8"
            )

        # Create _meta.json if missing
        meta_file = dest / "_meta.json"
        if not meta_file.exists():
            description = "Imported skill"
            if skill_md.exists():
                desc = extract_description_from_frontmatter(skill_md.read_text(encoding="utf-8"))
                if desc:
                    description = desc

            meta = {
                "name": skill_name,
                "description": description,
                "tags": [],
                "sub_skills": [],
                "source": "imported",
            }
            meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        file_count = len(list(dest.rglob("*")))
        return {
            "success": True,
            "name": skill_name,
            "path": str(dest),
            "files_imported": file_count,
        }, None

    except Exception as e:
        # Cleanup on failure
        if dest.exists():
            shutil.rmtree(dest)
        return None, str(e)


def import_files_json(
    skill_name: str,
    files: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Import files via JSON with base64 or text content.

    Args:
        skill_name: Name for the skill
        files: List of dicts with 'path', 'content', and optional 'base64' boolean

    Returns:
        Tuple of (result_data, error_message)
    """
    if not skill_name:
        return None, "Skill name is required"

    skill_name = sanitize_name(skill_name)
    skills_dir = get_skills_dir()
    skill_dir = skills_dir / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)

    imported = []

    for f in files:
        file_path = f.get("path", "")
        content = f.get("content", "")
        is_base64 = f.get("base64", False)

        # Security: prevent path traversal
        if not file_path or ".." in file_path:
            continue

        dest_path = skill_dir / file_path.replace("\\", "/")
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        if is_base64:
            dest_path.write_bytes(base64.b64decode(content))
        else:
            dest_path.write_text(content, encoding="utf-8")

        imported.append(file_path)

    # Create _meta.json if missing
    meta_file = skill_dir / "_meta.json"
    if not meta_file.exists():
        description = "Imported skill"
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            desc = extract_description_from_frontmatter(skill_md.read_text(encoding="utf-8"))
            if desc:
                description = desc

        meta = {
            "name": skill_name,
            "description": description,
            "tags": [],
            "sub_skills": [],
            "source": "json-upload",
        }
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return {"success": True, "name": skill_name, "files_imported": imported}, None
