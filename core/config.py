# core/config.py
# Configuration and path resolution - NO HARDCODED PATHS

import os
import sys
import shutil
from pathlib import Path

# Cache for computed paths
_app_dir = None
_skills_dir = None


def get_app_dir() -> Path:
    """Get the application directory (handles frozen PyInstaller builds)."""
    global _app_dir
    if _app_dir is None:
        if getattr(sys, 'frozen', False):
            # Running as PyInstaller bundle
            _app_dir = Path(sys.executable).parent
        else:
            # Running as script - go up from core/ to project root
            _app_dir = Path(__file__).parent.parent
    return _app_dir


def get_skills_dir() -> Path:
    """Get the skills directory path."""
    global _skills_dir
    if _skills_dir is None:
        _skills_dir = get_app_dir() / "skills"
        _skills_dir.mkdir(exist_ok=True)
    return _skills_dir


def find_claude_cli() -> str | None:
    """
    Find the Claude Code CLI executable using portable path resolution.

    Search order:
    1. PATH (via shutil.which)
    2. ~/.claude/claude.exe (Windows)
    3. ~/.claude/claude (Unix)
    4. ~/.claude/local/claude.exe (Windows alternate)
    5. ~/.claude/local/claude (Unix alternate)

    NO hardcoded usernames or absolute paths.
    """
    # First, check PATH
    cli_path = shutil.which('claude')
    if cli_path:
        return cli_path

    # Check standard Claude installation locations using expanduser
    home = Path.home()
    possible_locations = [
        home / '.claude' / 'claude.exe',
        home / '.claude' / 'claude',
        home / '.claude' / 'local' / 'claude.exe',
        home / '.claude' / 'local' / 'claude',
    ]

    for path in possible_locations:
        if path.exists():
            return str(path)

    # Final fallback - maybe it's in current directory
    for name in ['claude.exe', 'claude']:
        if os.path.exists(name):
            return name

    return None
