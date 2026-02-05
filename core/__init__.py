# Core module for Skills Manager
# Shared functionality between API server and standalone app

from .config import get_skills_dir, get_app_dir, find_claude_cli
from .utils import sanitize_name, extract_description_from_frontmatter, parse_frontmatter
from .skills import (
    list_all_skills,
    get_skill_by_name,
    create_skill,
    update_skill,
    delete_skill,
    import_folder,
    import_files_json,
)
from .browse import browse_skills_directory
from .claude_cli import (
    get_claude_status,
    run_claude_prompt,
    generate_skill_with_claude,
    improve_skill_with_claude,
)

__all__ = [
    # Config
    'get_skills_dir',
    'get_app_dir',
    'find_claude_cli',
    # Utils
    'sanitize_name',
    'extract_description_from_frontmatter',
    'parse_frontmatter',
    # Skills CRUD
    'list_all_skills',
    'get_skill_by_name',
    'create_skill',
    'update_skill',
    'delete_skill',
    'import_folder',
    'import_files_json',
    # Browse (restricted)
    'browse_skills_directory',
    # Claude CLI
    'get_claude_status',
    'run_claude_prompt',
    'generate_skill_with_claude',
    'improve_skill_with_claude',
]
