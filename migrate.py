#!/usr/bin/env python3
"""
Skill Migration Tool

Migrates Claude skills from various formats to the skills-mcp format:
- .skill ZIP archives
- Folder-based skills with SKILL.md
- Loose SKILL.md files with references

Usage:
    python migrate.py <source> [--name <skill-name>]
    python migrate.py /path/to/skill.skill
    python migrate.py /path/to/skill-folder
    python migrate.py /path/to/SKILL.md --name my-skill
"""

import argparse
import json
import re
import shutil
import zipfile
from pathlib import Path


SKILLS_DIR = Path(__file__).parent / "skills"


def extract_metadata_from_skill_md(content: str, skill_name: str) -> dict:
    """Extract metadata from SKILL.md content."""
    meta = {
        "name": skill_name,
        "description": "",
        "tags": [],
        "sub_skills": []
    }

    lines = content.split('\n')

    # Extract title as part of description
    for line in lines:
        if line.startswith('# '):
            title = line[2:].strip()
            break

    # Extract description from first paragraph after title
    in_description = False
    description_lines = []
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            if in_description:
                break
            continue
        if stripped.startswith('#'):
            if in_description:
                break
            continue
        in_description = True
        description_lines.append(stripped)

    meta["description"] = ' '.join(description_lines)[:200]

    # Extract tags from content keywords
    keywords = set()
    keyword_patterns = [
        r'\b(React|Vue|Angular|Svelte)\b',
        r'\b(TypeScript|JavaScript|Python|Rust|Go)\b',
        r'\b(Three\.js|WebGL|Canvas|SVG)\b',
        r'\b(multiplayer|networking|sync|websocket)\b',
        r'\b(physics|collision|gravity)\b',
        r'\b(validation|form|input)\b',
        r'\b(accessibility|a11y|WCAG|ARIA)\b',
        r'\b(performance|optimization|caching)\b',
        r'\b(security|authentication|authorization)\b',
        r'\b(testing|jest|vitest|cypress)\b',
    ]

    for pattern in keyword_patterns:
        matches = re.findall(pattern, content, re.IGNORECASE)
        keywords.update(m.lower() for m in matches)

    meta["tags"] = list(keywords)[:10]

    return meta


def find_references(source_dir: Path) -> list[dict]:
    """Find reference files and generate sub_skills metadata."""
    sub_skills = []

    # Check for references directory
    refs_dir = source_dir / "references"
    if refs_dir.exists():
        for ref_file in refs_dir.glob("*.md"):
            name = ref_file.stem
            content = ref_file.read_text(encoding="utf-8", errors="ignore")

            # Extract triggers from content
            triggers = extract_triggers(content, name)

            sub_skills.append({
                "name": name,
                "file": f"references/{ref_file.name}",
                "triggers": triggers
            })

    # Check for scripts directory (treat .md files as references)
    scripts_dir = source_dir / "scripts"
    if scripts_dir.exists():
        for script_file in scripts_dir.glob("*.md"):
            name = script_file.stem.replace('.js', '').replace('.ts', '')
            content = script_file.read_text(encoding="utf-8", errors="ignore")

            triggers = extract_triggers(content, name)

            sub_skills.append({
                "name": name,
                "file": f"scripts/{script_file.name}",
                "triggers": triggers
            })

    return sub_skills


def extract_triggers(content: str, name: str) -> list[str]:
    """Extract trigger words from content."""
    triggers = [name]

    # Look for code patterns
    patterns = [
        (r'class\s+(\w+)', 'class'),
        (r'function\s+(\w+)', 'function'),
        (r'const\s+(\w+)\s*=', 'const'),
        (r'interface\s+(\w+)', 'interface'),
    ]

    for pattern, _ in patterns:
        matches = re.findall(pattern, content)
        triggers.extend(matches[:3])

    # Look for headings as triggers
    headings = re.findall(r'^##\s+(.+)$', content, re.MULTILINE)
    for heading in headings[:5]:
        # Clean heading
        clean = re.sub(r'[^\w\s-]', '', heading).strip()
        if len(clean) > 3 and len(clean) < 30:
            triggers.append(clean)

    return list(set(triggers))[:10]


def migrate_skill_archive(archive_path: Path, target_name: str = None) -> Path:
    """Migrate a .skill ZIP archive."""
    print(f"Migrating skill archive: {archive_path}")

    # Extract to temp directory
    temp_dir = Path(__file__).parent / "_temp_extract"
    temp_dir.mkdir(exist_ok=True)

    try:
        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(temp_dir)

        # Find the skill directory (usually the first directory in the archive)
        extracted_dirs = [d for d in temp_dir.iterdir() if d.is_dir()]
        if extracted_dirs:
            source_dir = extracted_dirs[0]
            skill_name = target_name or source_dir.name.replace('-skill', '')
        else:
            # Files extracted directly
            source_dir = temp_dir
            skill_name = target_name or archive_path.stem.replace('-skill', '').replace('.skill', '')

        return migrate_skill_folder(source_dir, skill_name)

    finally:
        # Cleanup temp directory
        shutil.rmtree(temp_dir, ignore_errors=True)


def migrate_skill_folder(source_dir: Path, skill_name: str = None) -> Path:
    """Migrate a folder-based skill."""
    source_dir = Path(source_dir)
    skill_name = skill_name or source_dir.name

    # Normalize skill name
    skill_name = skill_name.lower().replace(' ', '-').replace('_', '-')
    skill_name = re.sub(r'-+', '-', skill_name).strip('-')

    print(f"Migrating skill folder: {source_dir} -> {skill_name}")

    target_dir = SKILLS_DIR / skill_name
    target_dir.mkdir(parents=True, exist_ok=True)

    # Find SKILL.md
    skill_md = source_dir / "SKILL.md"
    if not skill_md.exists():
        # Try to find it in subdirectories
        skill_mds = list(source_dir.rglob("SKILL.md"))
        if skill_mds:
            skill_md = skill_mds[0]
            source_dir = skill_md.parent

    if not skill_md.exists():
        print(f"  Warning: No SKILL.md found in {source_dir}")
        return None

    # Copy SKILL.md
    skill_content = skill_md.read_text(encoding="utf-8", errors="ignore")
    (target_dir / "SKILL.md").write_text(skill_content, encoding="utf-8")
    print(f"  Copied SKILL.md")

    # Copy references directory
    refs_source = source_dir / "references"
    if refs_source.exists():
        refs_target = target_dir / "references"
        refs_target.mkdir(exist_ok=True)
        for ref_file in refs_source.glob("*.md"):
            shutil.copy2(ref_file, refs_target / ref_file.name)
            print(f"  Copied references/{ref_file.name}")

    # Copy scripts directory (only .md files for documentation)
    scripts_source = source_dir / "scripts"
    if scripts_source.exists():
        scripts_target = target_dir / "scripts"
        scripts_target.mkdir(exist_ok=True)
        for script_file in scripts_source.glob("*.md"):
            shutil.copy2(script_file, scripts_target / script_file.name)
            print(f"  Copied scripts/{script_file.name}")
        # Also copy .js files if they exist (for reference)
        for script_file in scripts_source.glob("*.js"):
            shutil.copy2(script_file, scripts_target / script_file.name)
            print(f"  Copied scripts/{script_file.name}")

    # Generate _meta.json
    meta = extract_metadata_from_skill_md(skill_content, skill_name)
    meta["sub_skills"] = find_references(target_dir)

    meta_path = target_dir / "_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"  Generated _meta.json with {len(meta['sub_skills'])} sub-skills")

    return target_dir


def migrate_single_skill_md(skill_md_path: Path, skill_name: str) -> Path:
    """Migrate a single SKILL.md file."""
    skill_md_path = Path(skill_md_path)
    skill_name = skill_name.lower().replace(' ', '-').replace('_', '-')

    print(f"Migrating single SKILL.md: {skill_md_path} -> {skill_name}")

    target_dir = SKILLS_DIR / skill_name
    target_dir.mkdir(parents=True, exist_ok=True)

    # Copy SKILL.md
    skill_content = skill_md_path.read_text(encoding="utf-8", errors="ignore")
    (target_dir / "SKILL.md").write_text(skill_content, encoding="utf-8")

    # Check for sibling references or scripts directories
    parent_dir = skill_md_path.parent

    refs_source = parent_dir / "references"
    if refs_source.exists():
        refs_target = target_dir / "references"
        refs_target.mkdir(exist_ok=True)
        for ref_file in refs_source.glob("*.md"):
            shutil.copy2(ref_file, refs_target / ref_file.name)

    scripts_source = parent_dir / "scripts"
    if scripts_source.exists():
        scripts_target = target_dir / "scripts"
        scripts_target.mkdir(exist_ok=True)
        for script_file in scripts_source.glob("*.md"):
            shutil.copy2(script_file, scripts_target / script_file.name)

    # Generate _meta.json
    meta = extract_metadata_from_skill_md(skill_content, skill_name)
    meta["sub_skills"] = find_references(target_dir)

    meta_path = target_dir / "_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return target_dir


def main():
    parser = argparse.ArgumentParser(description="Migrate Claude skills to skills-mcp format")
    parser.add_argument("source", nargs="?", help="Path to .skill file, skill folder, or SKILL.md")
    parser.add_argument("--name", "-n", help="Override skill name")
    parser.add_argument("--list", "-l", action="store_true", help="List current skills")

    args = parser.parse_args()

    if args.list:
        print("\nCurrent skills:")
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if skill_dir.is_dir():
                meta_file = skill_dir / "_meta.json"
                if meta_file.exists():
                    meta = json.loads(meta_file.read_text())
                    sub_count = len(meta.get("sub_skills", []))
                    print(f"  {skill_dir.name}: {sub_count} sub-skills")
        return

    if not args.source:
        parser.print_help()
        return 1

    source = Path(args.source)

    if not source.exists():
        print(f"Error: Source not found: {source}")
        return 1

    if source.suffix == ".skill" or (source.is_file() and zipfile.is_zipfile(source)):
        result = migrate_skill_archive(source, args.name)
    elif source.is_dir():
        result = migrate_skill_folder(source, args.name)
    elif source.name == "SKILL.md" or source.suffix == ".md":
        if not args.name:
            print("Error: --name required when migrating single SKILL.md file")
            return 1
        result = migrate_single_skill_md(source, args.name)
    else:
        print(f"Error: Unsupported source format: {source}")
        return 1

    if result:
        print(f"\nMigration complete: {result}")
        print("Run 'reload_index' in the MCP server to load the new skill")

    return 0


if __name__ == "__main__":
    exit(main())
