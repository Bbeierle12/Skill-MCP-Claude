# skills_manager_app.py
# Standalone Skills Manager - All-in-one file for PyInstaller
# Refactored to use shared core module

import subprocess
import sys
import os
import time
import webbrowser
import socket
import threading

# Try to import Flask
try:
    from flask import Flask, jsonify, request, send_from_directory
    from flask_cors import CORS
except ImportError:
    print("Installing required packages...")
    subprocess.run([sys.executable, "-m", "pip", "install", "flask", "flask-cors"], check=True)
    from flask import Flask, jsonify, request, send_from_directory
    from flask_cors import CORS

# Import from core module
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
)

# Configuration
PORT = 5050
HOST = "127.0.0.1"

APP_DIR = get_app_dir()
SKILLS_DIR = get_skills_dir()

# Create Flask app
app = Flask(__name__, static_folder=str(APP_DIR))

# Security: Restrict CORS to localhost origins only
CORS(app, origins=[
    'http://localhost:5050',
    'http://127.0.0.1:5050',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
], supports_credentials=False)


# ============ Routes ============

@app.route('/')
def index():
    return send_from_directory(str(APP_DIR), 'skills-manager.html')


@app.route('/api/skills', methods=['GET'])
def api_list_skills():
    """List all skills with their metadata."""
    return jsonify({"skills": list_all_skills()})


@app.route('/api/skills/<name>', methods=['GET'])
def api_get_skill(name):
    """Get a specific skill's details."""
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
        overwrite=data.get("overwrite", False),
    )
    if error:
        status = 409 if "exists" in error else 400
        return jsonify({"error": error}), status
    return jsonify(result)


@app.route('/api/skills/<name>', methods=['PUT'])
def api_update_skill(name):
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
def api_delete_skill(name):
    """Delete a skill."""
    result, error = delete_skill(name)
    if error:
        return jsonify({"error": error}), 404
    return jsonify(result)


@app.route('/api/import/folder', methods=['POST'])
def api_import_folder():
    """Import a skill from a folder path."""
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
    """Import files via JSON."""
    data = request.json
    result, error = import_files_json(
        skill_name=data.get("skill_name", ""),
        files=data.get("files", []),
    )
    if error:
        return jsonify({"error": error}), 400
    return jsonify(result)


@app.route('/api/browse', methods=['GET'])
def api_browse_filesystem():
    """
    Browse the skills directory ONLY.

    SECURITY: Restricted to skills/ directory only.
    """
    relative_path = request.args.get("path", "")
    result, error = browse_skills_directory(relative_path)
    if error:
        status = 403 if "denied" in error.lower() else 404
        return jsonify({"error": error}), status
    return jsonify(result)


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


@app.route('/api/reload', methods=['POST'])
def api_reload_index():
    """Reload skills index."""
    return jsonify({"success": True})


# ============ Main ============

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0


def open_browser():
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}")


def main():
    cli_path = find_claude_cli()
    print("")
    print("=" * 60)
    print("                    SKILLS MANAGER")
    print("=" * 60)
    print(f"  Server:     http://{HOST}:{PORT}")
    print(f"  Skills:     {SKILLS_DIR}")
    print(f"  Claude CLI: {cli_path or 'Not found'}")
    print(f"  Browse:     RESTRICTED to skills/ directory")
    print("-" * 60)
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print("")

    if is_port_in_use(PORT):
        print(f"[!] Port {PORT} in use. Opening browser...")
        webbrowser.open(f"http://{HOST}:{PORT}")
        input("\nPress Enter to exit...")
        return

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print("\n[*] Stopped.")


if __name__ == "__main__":
    main()
