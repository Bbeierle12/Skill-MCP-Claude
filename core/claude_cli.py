# core/claude_cli.py
# Claude Code CLI integration

import subprocess
from typing import Any

from .config import find_claude_cli, get_skills_dir


def get_claude_status() -> dict[str, Any]:
    """Check if Claude CLI is available and get version info."""
    cli_path = find_claude_cli()

    if not cli_path:
        return {"available": False, "error": "Claude Code CLI not found"}

    try:
        result = subprocess.run(
            [cli_path, '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        version = result.stdout.strip() or result.stderr.strip()
        return {"available": True, "path": cli_path, "version": version}
    except subprocess.TimeoutExpired:
        return {"available": False, "error": "CLI timed out"}
    except Exception as e:
        return {"available": False, "error": str(e)}


def run_claude_prompt(
    prompt: str,
    skill_context: str = "",
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Run a prompt through Claude CLI.

    Args:
        prompt: The user's prompt
        skill_context: Optional skill context to prepend

    Returns:
        Tuple of (result_data, error_message)
    """
    cli_path = find_claude_cli()
    if not cli_path:
        return None, "Claude Code CLI not found"

    full_prompt = prompt
    if skill_context:
        full_prompt = f"Using this skill context:\n\n{skill_context}\n\n{prompt}"

    try:
        result = subprocess.run(
            [cli_path, '-p', full_prompt],
            capture_output=True,
            text=True,
            cwd=str(get_skills_dir()),
            timeout=120
        )
        return {
            "success": True,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }, None
    except subprocess.TimeoutExpired:
        return None, "Timeout"
    except Exception as e:
        return None, str(e)


def generate_skill_with_claude(idea: str) -> tuple[dict[str, Any] | None, str | None]:
    """
    Generate a new skill using Claude CLI.

    Args:
        idea: Description of the skill to generate

    Returns:
        Tuple of (result_data, error_message)
    """
    if not idea:
        return None, "Skill idea required"

    cli_path = find_claude_cli()
    if not cli_path:
        return None, "Claude Code CLI not found"

    prompt = f"""Generate a Claude skill based on this idea: {idea}

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
        result = subprocess.run(
            [cli_path, '-p', prompt, '--output-format', 'text'],
            capture_output=True,
            text=True,
            timeout=180
        )
        output = result.stdout.strip()

        skill_data = {"content": output}

        # Try to extract name and description from frontmatter
        if output.startswith("---"):
            try:
                end = output.index("---", 3)
                for line in output[3:end].split("\n"):
                    if line.startswith("name:"):
                        skill_data["name"] = line.split(":", 1)[1].strip()
                    elif line.startswith("description:"):
                        skill_data["description"] = line.split(":", 1)[1].strip()
            except ValueError:
                pass

        return {"success": True, "skill": skill_data}, None
    except subprocess.TimeoutExpired:
        return None, "Timeout"
    except Exception as e:
        return None, str(e)


def improve_skill_with_claude(
    skill_name: str,
    improvement_request: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Improve an existing skill using Claude CLI.

    Args:
        skill_name: Name of the skill to improve
        improvement_request: Description of desired improvements

    Returns:
        Tuple of (result_data, error_message)
    """
    skills_dir = get_skills_dir()
    skill_file = skills_dir / skill_name / "SKILL.md"

    if not skill_file.exists():
        return None, f"Skill '{skill_name}' not found"

    cli_path = find_claude_cli()
    if not cli_path:
        return None, "Claude Code CLI not found"

    current_content = skill_file.read_text(encoding="utf-8")
    prompt = f"""Improve this skill: {improvement_request}

Current SKILL.md:
{current_content}

Output the complete improved SKILL.md file only."""

    try:
        result = subprocess.run(
            [cli_path, '-p', prompt, '--output-format', 'text'],
            capture_output=True,
            text=True,
            timeout=180
        )
        return {
            "success": True,
            "improved_content": result.stdout.strip(),
            "original_content": current_content,
        }, None
    except subprocess.TimeoutExpired:
        return None, "Timeout"
    except Exception as e:
        return None, str(e)
