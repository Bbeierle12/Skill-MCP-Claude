# skills_manager_api.py
# HTTP API server for managing skills with Claude Code CLI integration
# Refactored to use shared core module

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pathlib import Path

from core import (
    get_skills_dir,
    get_app_dir,
    find_claude_cli,
    list_all_skills,
    get_skill_by_name,
    create_skill,
    update_skill,
    delete_skill,
    import_folder,
    import_files_json,
    browse_skills_directory,
    get_claude_status,
    run_claude_prompt,
    generate_skill_with_claude,
    improve_skill_with_claude,
)

app = Flask(__name__)

# Security: Restrict CORS to localhost origins only
CORS(app, origins=[
    'http://localhost:5050',
    'http://127.0.0.1:5050',
    'http://localhost:3000',  # Dev server
    'http://127.0.0.1:3000',
], supports_credentials=False)

SKILLS_DIR = get_skills_dir()
APP_DIR = get_app_dir()


# ============ Static Files ============

@app.route('/')
def index():
    return send_from_directory(str(APP_DIR), 'skills-manager.html')


# ============ Skills CRUD ============

@app.route('/api/skills', methods=['GET'])
def api_list_skills():
    """List all skills with their metadata."""
    skills = list_all_skills()
    return jsonify({"skills": skills})


@app.route('/api/skills/<name>', methods=['GET'])
def api_get_skill(name: str):
    """Get a specific skill's details including all files."""
    skill_data, error = get_skill_by_name(name)
    if error:
        return jsonify({"error": error}), 404
    return jsonify(skill_data)


@app.route('/api/skills', methods=['POST'])
def api_create_skill():
    """Create a new skill."""
    data = request.json
    result, error = create_skill(
        name=data.get("name", ""),
        description=data.get("description", ""),
        content=data.get("content", ""),
        tags=data.get("tags", []),
        sub_skills=data.get("sub_skills", []),
        overwrite=data.get("overwrite", False),
    )
    if error:
        status = 409 if "already exists" in error else 400
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/skills/<name>', methods=['PUT'])
def api_update_skill(name: str):
    """Update an existing skill."""
    data = request.json
    result, error = update_skill(
        name=name,
        description=data.get("description", ""),
        content=data.get("content", ""),
        tags=data.get("tags"),
    )
    if error:
        return jsonify({"error": error}), 404
    return jsonify(result)


@app.route('/api/skills/<name>', methods=['DELETE'])
def api_delete_skill(name: str):
    """Delete a skill."""
    result, error = delete_skill(name)
    if error:
        return jsonify({"error": error}), 404
    return jsonify(result)


# ============ Import ============

@app.route('/api/import/folder', methods=['POST'])
def api_import_folder():
    """Import a skill from a folder path on disk."""
    data = request.json
    result, error = import_folder(
        source_path=data.get("path", ""),
        new_name=data.get("name", ""),
    )
    if error:
        status = 404 if "not found" in error.lower() else 409 if "exists" in error else 400
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/import/json', methods=['POST'])
def api_import_files_json():
    """Import files via JSON with base64 content."""
    data = request.json
    result, error = import_files_json(
        skill_name=data.get("skill_name", ""),
        files=data.get("files", []),
    )
    if error:
        return jsonify({"error": error}), 400
    return jsonify(result)


# ============ Browse (RESTRICTED to skills/ directory) ============

@app.route('/api/browse', methods=['GET'])
def api_browse_filesystem():
    """
    Browse the skills directory ONLY.

    SECURITY: This endpoint is intentionally restricted to only browse
    within the skills/ directory. Pass relative paths like:
    - /api/browse (root of skills/)
    - /api/browse?path=my-skill
    - /api/browse?path=my-skill/scripts
    """
    relative_path = request.args.get("path", "")
    result, error = browse_skills_directory(relative_path)
    if error:
        status = 403 if "denied" in error.lower() else 404
        return jsonify({"error": error}), status
    return jsonify(result)


# ============ Claude Code CLI Integration ============

@app.route('/api/claude/status', methods=['GET'])
def api_claude_status():
    """Check Claude CLI availability."""
    return jsonify(get_claude_status())


@app.route('/api/claude/run', methods=['POST'])
def api_claude_run():
    """Run a prompt through Claude CLI."""
    data = request.json
    result, error = run_claude_prompt(
        prompt=data.get("prompt", ""),
        skill_context=data.get("skill_context", ""),
    )
    if error:
        status = 408 if error == "Timeout" else 404 if "not found" in error.lower() else 500
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/claude/generate-skill', methods=['POST'])
def api_claude_generate_skill():
    """Generate a skill using Claude CLI."""
    data = request.json
    result, error = generate_skill_with_claude(idea=data.get("idea", ""))
    if error:
        status = 408 if error == "Timeout" else 404 if "not found" in error.lower() else 400
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/claude/improve-skill', methods=['POST'])
def api_claude_improve_skill():
    """Improve an existing skill using Claude CLI."""
    data = request.json
    result, error = improve_skill_with_claude(
        skill_name=data.get("skill_name", ""),
        improvement_request=data.get("request", ""),
    )
    if error:
        status = 408 if error == "Timeout" else 404 if "not found" in error.lower() else 500
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/reload', methods=['POST'])
def api_reload_index():
    """Reload skills index."""
    return jsonify({"success": True, "message": "Skills reloaded"})


# ============ Main ============

if __name__ == "__main__":
    cli_path = find_claude_cli()
    print(f"""
================================================================
           Skills Manager API + Claude Code CLI
================================================================
  Server:     http://localhost:5050
  Skills:     {SKILLS_DIR}
  Claude CLI: {cli_path or 'Not found'}
  Browse:     RESTRICTED to skills/ directory
================================================================
""")
    app.run(port=5050, debug=True)
