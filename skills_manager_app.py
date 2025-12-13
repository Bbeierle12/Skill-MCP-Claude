# skills_manager_app.py
# Standalone Skills Manager - All-in-one file for PyInstaller
import subprocess
import sys
import os
import time
import webbrowser
import socket
import threading
import json
import re
import shutil
import base64
from pathlib import Path

# Try to import Flask
try:
    from flask import Flask, jsonify, request, send_from_directory
    from flask_cors import CORS
except ImportError:
    print("Installing required packages...")
    subprocess.run([sys.executable, "-m", "pip", "install", "flask", "flask-cors"], check=True)
    from flask import Flask, jsonify, request, send_from_directory
    from flask_cors import CORS

# Configuration
PORT = 5050
HOST = "127.0.0.1"

def get_app_dir():
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent

APP_DIR = get_app_dir()
SKILLS_DIR = APP_DIR / "skills"

# Ensure skills directory exists
SKILLS_DIR.mkdir(exist_ok=True)

# Create Flask app
app = Flask(__name__, static_folder=str(APP_DIR))
CORS(app)

def sanitize_name(name: str) -> str:
    return re.sub(r'[^a-z0-9-]', '-', name.lower().strip()).strip('-')

def find_claude_cli():
    possible_paths = [
        shutil.which('claude'),
        os.path.expanduser('~/.claude/claude.exe'),
        os.path.expanduser('~/.claude/local/claude.exe'),
        'claude.exe', 'claude'
    ]
    for path in possible_paths:
        if path and os.path.exists(path):
            return path
    return shutil.which('claude')

# ============ Routes ============

@app.route('/')
def index():
    return send_from_directory(str(APP_DIR), 'skills-manager.html')

@app.route('/api/skills', methods=['GET'])
def list_skills():
    skills = []
    if SKILLS_DIR.exists():
        for skill_dir in SKILLS_DIR.iterdir():
            if skill_dir.is_dir():
                skill_data = {"name": skill_dir.name}
                meta_file = skill_dir / "_meta.json"
                if meta_file.exists():
                    try:
                        skill_data.update(json.loads(meta_file.read_text(encoding="utf-8")))
                    except: pass
                skill_file = skill_dir / "SKILL.md"
                if skill_file.exists():
                    content = skill_file.read_text(encoding="utf-8")
                    skill_data["content"] = content
                    if "description" not in skill_data and content.startswith("---"):
                        try:
                            end = content.index("---", 3)
                            for line in content[3:end].split("\n"):
                                if line.startswith("description:"):
                                    skill_data["description"] = line.split(":", 1)[1].strip()
                                    break
                        except: pass
                skill_data["has_scripts"] = (skill_dir / "scripts").exists()
                skill_data["has_references"] = (skill_dir / "references").exists()
                skill_data["file_count"] = len(list(skill_dir.rglob("*")))
                skills.append(skill_data)
    return jsonify({"skills": skills})

@app.route('/api/skills/<name>', methods=['GET'])
def get_skill(name):
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    skill_data = {"name": name, "files": []}
    meta_file = skill_dir / "_meta.json"
    if meta_file.exists():
        skill_data.update(json.loads(meta_file.read_text(encoding="utf-8")))
    skill_file = skill_dir / "SKILL.md"
    if skill_file.exists():
        skill_data["content"] = skill_file.read_text(encoding="utf-8")
    for f in skill_dir.rglob("*"):
        if f.is_file():
            skill_data["files"].append(str(f.relative_to(skill_dir)))
    return jsonify(skill_data)

@app.route('/api/skills', methods=['POST'])
def create_skill():
    data = request.json
    name = sanitize_name(data.get("name", ""))
    if not name:
        return jsonify({"error": "Skill name required"}), 400
    skill_dir = SKILLS_DIR / name
    if skill_dir.exists() and not data.get("overwrite"):
        return jsonify({"error": f"Skill '{name}' exists"}), 409
    skill_dir.mkdir(parents=True, exist_ok=True)
    description = data.get("description", "")
    content = data.get("content", "")
    (skill_dir / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\n\n{content}", encoding="utf-8")
    meta = {"name": name, "description": description, "tags": data.get("tags", []), "sub_skills": [], "source": "imported"}
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return jsonify({"success": True, "name": name, "path": str(skill_dir)})

@app.route('/api/skills/<name>', methods=['PUT'])
def update_skill(name):
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    data = request.json
    description = data.get("description", "")
    content = data.get("content", "")
    (skill_dir / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\n\n{content}", encoding="utf-8")
    meta_file = skill_dir / "_meta.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
    meta.update({"name": name, "description": description, "tags": data.get("tags", meta.get("tags", []))})
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return jsonify({"success": True, "name": name})

@app.route('/api/skills/<name>', methods=['DELETE'])
def delete_skill(name):
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    shutil.rmtree(skill_dir)
    return jsonify({"success": True, "name": name})

@app.route('/api/import/folder', methods=['POST'])
def import_folder():
    data = request.json
    source_path = data.get("path", "")
    if not source_path:
        return jsonify({"error": "Source path required"}), 400
    source = Path(source_path)
    if not source.exists() or not source.is_dir():
        return jsonify({"error": "Invalid path"}), 404
    skill_name = sanitize_name(data.get("name", "") or source.name)
    dest = SKILLS_DIR / skill_name
    if dest.exists():
        return jsonify({"error": f"Skill '{skill_name}' exists"}), 409
    try:
        shutil.copytree(source, dest)
        if not (dest / "SKILL.md").exists():
            (dest / "SKILL.md").write_text(f"---\nname: {skill_name}\ndescription: Imported\n---\n\n# {skill_name}", encoding="utf-8")
        if not (dest / "_meta.json").exists():
            (dest / "_meta.json").write_text(json.dumps({"name": skill_name, "description": "Imported", "tags": [], "sub_skills": []}, indent=2), encoding="utf-8")
        return jsonify({"success": True, "name": skill_name, "path": str(dest), "files_imported": len(list(dest.rglob("*")))})
    except Exception as e:
        if dest.exists(): shutil.rmtree(dest)
        return jsonify({"error": str(e)}), 500

@app.route('/api/import/json', methods=['POST'])
def import_files_json():
    data = request.json
    skill_name = sanitize_name(data.get("skill_name", ""))
    if not skill_name:
        return jsonify({"error": "Skill name required"}), 400
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    imported = []
    for f in data.get("files", []):
        file_path = f.get("path", "")
        if not file_path or ".." in file_path: continue
        dest_path = skill_dir / file_path.replace("\\", "/")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if f.get("base64"):
            dest_path.write_bytes(base64.b64decode(f.get("content", "")))
        else:
            dest_path.write_text(f.get("content", ""), encoding="utf-8")
        imported.append(file_path)
    if not (skill_dir / "_meta.json").exists():
        (skill_dir / "_meta.json").write_text(json.dumps({"name": skill_name, "description": "Imported", "tags": [], "sub_skills": []}, indent=2), encoding="utf-8")
    return jsonify({"success": True, "name": skill_name, "files_imported": imported})

@app.route('/api/browse', methods=['GET'])
def browse_filesystem():
    path = request.args.get("path", "")
    if not path:
        if os.name == 'nt':
            import string
            drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
            return jsonify({"path": "", "dirs": [{"name": d, "path": d, "is_skill": False} for d in drives], "files": []})
        path = "/"
    p = Path(path)
    if not p.exists():
        return jsonify({"error": "Path not found"}), 404
    dirs, files = [], []
    try:
        for item in sorted(p.iterdir()):
            if item.name.startswith('.'): continue
            if item.is_dir():
                dirs.append({"name": item.name, "path": str(item), "is_skill": (item / "SKILL.md").exists()})
            else:
                files.append({"name": item.name, "path": str(item)})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    return jsonify({"path": str(p), "parent": str(p.parent) if p.parent != p else None, "dirs": dirs[:100], "files": files[:100]})

@app.route('/api/claude/status', methods=['GET'])
def claude_status():
    cli = find_claude_cli()
    if cli:
        try:
            result = subprocess.run([cli, '--version'], capture_output=True, text=True, timeout=5)
            return jsonify({"available": True, "path": cli, "version": result.stdout.strip() or result.stderr.strip()})
        except: pass
    return jsonify({"available": False, "error": "Claude CLI not found"})

@app.route('/api/claude/run', methods=['POST'])
def claude_run():
    data = request.json
    cli = find_claude_cli()
    if not cli:
        return jsonify({"error": "Claude CLI not found"}), 404
    prompt = data.get("prompt", "")
    if data.get("skill_context"):
        prompt = f"Using this skill:\n\n{data['skill_context']}\n\n{prompt}"
    try:
        result = subprocess.run([cli, '-p', prompt], capture_output=True, text=True, cwd=str(SKILLS_DIR), timeout=120)
        return jsonify({"success": True, "stdout": result.stdout, "stderr": result.stderr})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/claude/generate-skill', methods=['POST'])
def claude_generate_skill():
    cli = find_claude_cli()
    if not cli:
        return jsonify({"error": "Claude CLI not found"}), 404
    idea = request.json.get("idea", "")
    if not idea:
        return jsonify({"error": "Idea required"}), 400
    prompt = f"""Generate a Claude skill: {idea}

Output SKILL.md format:
---
name: skill-name
description: One line description
---
# Skill Name
## Overview
## When to Use
## Quick Start
## Best Practices

Only output SKILL.md content."""
    try:
        result = subprocess.run([cli, '-p', prompt], capture_output=True, text=True, timeout=180)
        output = result.stdout.strip()
        skill_data = {"content": output}
        if output.startswith("---"):
            try:
                end = output.index("---", 3)
                for line in output[3:end].split("\n"):
                    if line.startswith("name:"): skill_data["name"] = line.split(":", 1)[1].strip()
                    elif line.startswith("description:"): skill_data["description"] = line.split(":", 1)[1].strip()
            except: pass
        return jsonify({"success": True, "skill": skill_data})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reload', methods=['POST'])
def reload_index():
    return jsonify({"success": True})

# ============ Main ============

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0

def open_browser():
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}")

def main():
    print("")
    print("=" * 60)
    print("                    SKILLS MANAGER")
    print("=" * 60)
    print(f"  Server:     http://{HOST}:{PORT}")
    print(f"  Skills:     {SKILLS_DIR}")
    print(f"  Claude CLI: {find_claude_cli() or 'Not found'}")
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
