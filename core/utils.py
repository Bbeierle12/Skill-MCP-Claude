# core/utils.py
# Shared utility functions

import re
from typing import Optional


def sanitize_name(name: str) -> str:
    """Convert name to valid skill directory name."""
    if not name:
        return ""
    return re.sub(r'[^a-z0-9-]', '-', name.lower().strip()).strip('-')


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Parse YAML frontmatter from markdown content.

    Returns:
        Tuple of (frontmatter_dict, body_content)
    """
    if not content.startswith('---'):
        return {}, content

    try:
        end_index = content.index('---', 3)
        frontmatter_text = content[3:end_index].strip()
        body = content[end_index + 3:].strip()

        frontmatter = {}
        for line in frontmatter_text.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip()

        return frontmatter, body
    except ValueError:
        return {}, content


def extract_description_from_frontmatter(content: str) -> Optional[str]:
    """Extract description field from markdown frontmatter."""
    frontmatter, _ = parse_frontmatter(content)
    return frontmatter.get('description')


def create_skill_markdown(name: str, description: str, content: str) -> str:
    """Create a properly formatted SKILL.md file content."""
    return f"""---
name: {name}
description: {description}
---

{content}
"""
