# skills_manager_api.py
# HTTP API server for managing skills with Claude Code CLI integration
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS
from pathlib import Path
import json
import re
import subprocess
import os
import shutil
import base64

app = Flask(__name__)
CORS(app)

SKILLS_DIR = Path(__file__).parent / "skills"

def sanitize_name(name: str) -> str:
    """Convert name to valid skill directory name."""
    return re.sub(r'[^a-z0-9-]', '-', name.lower().strip()).strip('-')

def find_claude_cli():
    """Find the Claude Code CLI executable."""
    possible_paths = [
        shutil.which('claude'),
        os.path.expanduser('~/.claude/claude.exe'),
        os.path.expanduser('~/.claude/claude'),
        'C:/Users/Bbeie/.claude/local/claude.exe',
        'claude.exe',
        'claude'
    ]
    for path in possible_paths:
        if path and os.path.exists(path):
            return path
    return shutil.which('claude')

@app.route('/')
def index():
    return send_from_directory('.', 'skills-manager.html')

@app.route('/api/skills', methods=['GET'])
def list_skills():
    """List all skills with their metadata."""
    skills = []
    for skill_dir in SKILLS_DIR.iterdir():
        if skill_dir.is_dir():
            skill_data = {"name": skill_dir.name}
            
            meta_file = skill_dir / "_meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    skill_data.update(meta)
                except:
                    pass
            
            skill_file = skill_dir / "SKILL.md"
            if skill_file.exists():
                content = skill_file.read_text(encoding="utf-8")
                skill_data["content"] = content
                
                if "description" not in skill_data:
                    if content.startswith("---"):
                        try:
                            end = content.index("---", 3)
                            frontmatter = content[3:end]
                            for line in frontmatter.split("\n"):
                                if line.startswith("description:"):
                                    skill_data["description"] = line.split(":", 1)[1].strip()
                                    break
                        except:
                            pass
            
            # Get file structure info
            skill_data["has_scripts"] = (skill_dir / "scripts").exists()
            skill_data["has_references"] = (skill_dir / "references").exists()
            skill_data["file_count"] = len(list(skill_dir.rglob("*")))
            
            skills.append(skill_data)
    
    return jsonify({"skills": skills})

@app.route('/api/skills/<name>', methods=['GET'])
def get_skill(name: str):
    """Get a specific skill's details including all files."""
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
    
    # List all files in skill directory
    for f in skill_dir.rglob("*"):
        if f.is_file():
            rel_path = f.relative_to(skill_dir)
            skill_data["files"].append(str(rel_path))
    
    return jsonify(skill_data)

@app.route('/api/skills', methods=['POST'])
def create_skill():
    """Create a new skill."""
    data = request.json
    
    name = sanitize_name(data.get("name", ""))
    if not name:
        return jsonify({"error": "Skill name is required"}), 400
    
    skill_dir = SKILLS_DIR / name
    if skill_dir.exists() and not data.get("overwrite"):
        return jsonify({"error": f"Skill '{name}' already exists"}), 409
    
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    description = data.get("description", "")
    content = data.get("content", "")
    
    skill_md = f"""---
name: {name}
description: {description}
---

{content}
"""
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    
    meta = {
        "name": name,
        "description": description,
        "tags": data.get("tags", []),
        "sub_skills": data.get("sub_skills", []),
        "source": "imported"
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify({"success": True, "name": name, "path": str(skill_dir)})

@app.route('/api/skills/<name>', methods=['PUT'])
def update_skill(name: str):
    """Update an existing skill."""
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    
    data = request.json
    description = data.get("description", "")
    content = data.get("content", "")
    
    skill_md = f"""---
name: {name}
description: {description}
---

{content}
"""
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    
    meta_file = skill_dir / "_meta.json"
    meta = {}
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except:
            pass
    
    meta.update({
        "name": name,
        "description": description,
        "tags": data.get("tags", meta.get("tags", []))
    })
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify({"success": True, "name": name})

@app.route('/api/skills/<name>', methods=['DELETE'])
def delete_skill(name: str):
    """Delete a skill."""
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        return jsonify({"error": f"Skill '{name}' not found"}), 404
    
    shutil.rmtree(skill_dir)
    return jsonify({"success": True, "name": name})

# ============ Import Folder/Files ============

@app.route('/api/import/folder', methods=['POST'])
def import_folder():
    """Import a skill from a folder path on disk."""
    data = request.json
    source_path = data.get("path", "")
    new_name = data.get("name", "")  # Optional rename
    
    if not source_path:
        return jsonify({"error": "Source path is required"}), 400
    
    source = Path(source_path)
    if not source.exists():
        return jsonify({"error": f"Path not found: {source_path}"}), 404
    
    if not source.is_dir():
        return jsonify({"error": "Path must be a directory"}), 400
    
    # Determine skill name
    skill_name = sanitize_name(new_name) if new_name else sanitize_name(source.name)
    dest = SKILLS_DIR / skill_name
    
    if dest.exists():
        return jsonify({"error": f"Skill '{skill_name}' already exists. Use overwrite option."}), 409
    
    try:
        # Copy entire directory
        shutil.copytree(source, dest)
        
        # Verify SKILL.md exists or create minimal one
        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            skill_md.write_text(f"---\nname: {skill_name}\ndescription: Imported skill\n---\n\n# {skill_name}\n\nImported from {source_path}", encoding="utf-8")
        
        # Create _meta.json if missing
        meta_file = dest / "_meta.json"
        if not meta_file.exists():
            # Try to extract description from SKILL.md
            description = "Imported skill"
            content = skill_md.read_text(encoding="utf-8")
            if content.startswith("---"):
                try:
                    end = content.index("---", 3)
                    for line in content[3:end].split("\n"):
                        if line.startswith("description:"):
                            description = line.split(":", 1)[1].strip()
                            break
                except:
                    pass
            
            meta = {
                "name": skill_name,
                "description": description,
                "tags": [],
                "sub_skills": [],
                "source": f"imported:{source_path}"
            }
            meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        
        file_count = len(list(dest.rglob("*")))
        return jsonify({
            "success": True,
            "name": skill_name,
            "path": str(dest),
            "files_imported": file_count
        })
        
    except Exception as e:
        # Cleanup on failure
        if dest.exists():
            shutil.rmtree(dest)
        return jsonify({"error": str(e)}), 500

@app.route('/api/import/files', methods=['POST'])
def import_files():
    """Import multiple files into a skill (multipart form data)."""
    skill_name = request.form.get("skill_name", "")
    
    if not skill_name:
        return jsonify({"error": "Skill name is required"}), 400
    
    skill_name = sanitize_name(skill_name)
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    imported = []
    
    for key in request.files:
        file = request.files[key]
        if file.filename:
            # Preserve relative path structure
            filename = file.filename.replace("\\", "/")
            
            # Security: prevent path traversal
            if ".." in filename:
                continue
            
            dest_path = skill_dir / filename
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            file.save(str(dest_path))
            imported.append(filename)
    
    # Create _meta.json if it doesn't exist
    meta_file = skill_dir / "_meta.json"
    if not meta_file.exists():
        description = "Imported skill"
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            content = skill_md.read_text(encoding="utf-8")
            if content.startswith("---"):
                try:
                    end = content.index("---", 3)
                    for line in content[3:end].split("\n"):
                        if line.startswith("description:"):
                            description = line.split(":", 1)[1].strip()
                            break
                except:
                    pass
        
        meta = {
            "name": skill_name,
            "description": description,
            "tags": [],
            "sub_skills": [],
            "source": "file-upload"
        }
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify({
        "success": True,
        "name": skill_name,
        "files_imported": imported
    })

@app.route('/api/import/json', methods=['POST'])
def import_files_json():
    """Import files via JSON with base64 content."""
    data = request.json
    skill_name = data.get("skill_name", "")
    files = data.get("files", [])  # [{path: "SKILL.md", content: "...", base64: false}, ...]
    
    if not skill_name:
        return jsonify({"error": "Skill name is required"}), 400
    
    skill_name = sanitize_name(skill_name)
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    imported = []
    
    for f in files:
        file_path = f.get("path", "")
        content = f.get("content", "")
        is_base64 = f.get("base64", False)
        
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
    if not meta_file.exists() and "SKILL.md" in imported:
        skill_md = skill_dir / "SKILL.md"
        content = skill_md.read_text(encoding="utf-8")
        description = "Imported skill"
        if content.startswith("---"):
            try:
                end = content.index("---", 3)
                for line in content[3:end].split("\n"):
                    if line.startswith("description:"):
                        description = line.split(":", 1)[1].strip()
                        break
            except:
                pass
        
        meta = {"name": skill_name, "description": description, "tags": [], "sub_skills": [], "source": "json-upload"}
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    
    return jsonify({"success": True, "name": skill_name, "files_imported": imported})

@app.route('/api/browse', methods=['GET'])
def browse_filesystem():
    """Browse filesystem to select folders for import."""
    path = request.args.get("path", "")
    
    if not path:
        # Return drives on Windows, root on Unix
        if os.name == 'nt':
            import string
            drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
            return jsonify({"path": "", "dirs": drives, "files": []})
        else:
            path = "/"
    
    p = Path(path)
    if not p.exists():
        return jsonify({"error": f"Path not found: {path}"}), 404
    
    dirs = []
    files = []
    
    try:
        for item in sorted(p.iterdir()):
            if item.name.startswith('.'):
                continue
            if item.is_dir():
                # Check if it looks like a skill folder
                is_skill = (item / "SKILL.md").exists()
                dirs.append({"name": item.name, "path": str(item), "is_skill": is_skill})
            else:
                files.append({"name": item.name, "path": str(item)})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    
    return jsonify({
        "path": str(p),
        "parent": str(p.parent) if p.parent != p else None,
        "dirs": dirs[:100],  # Limit results
        "files": files[:100]
    })

# ============ Claude Code CLI Integration ============

@app.route('/api/claude/status', methods=['GET'])
def claude_status():
    cli_path = find_claude_cli()
    if cli_path:
        try:
            result = subprocess.run([cli_path, '--version'], capture_output=True, text=True, timeout=5)
            return jsonify({"available": True, "path": cli_path, "version": result.stdout.strip() or result.stderr.strip()})
        except Exception as e:
            return jsonify({"available": False, "error": str(e)})
    return jsonify({"available": False, "error": "Claude Code CLI not found"})

@app.route('/api/claude/run', methods=['POST'])
def claude_run():
    data = request.json
    prompt = data.get("prompt", "")
    skill_context = data.get("skill_context", "")
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    full_prompt = f"Using this skill context:\n\n{skill_context}\n\n{prompt}" if skill_context else prompt
    
    try:
        result = subprocess.run([cli_path, '-p', full_prompt], capture_output=True, text=True, cwd=str(SKILLS_DIR), timeout=120)
        return jsonify({"success": True, "stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/claude/generate-skill', methods=['POST'])
def claude_generate_skill():
    data = request.json
    skill_idea = data.get("idea", "")
    
    if not skill_idea:
        return jsonify({"error": "Skill idea required"}), 400
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    prompt = f"""Generate a Claude skill based on this idea: {skill_idea}

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
        result = subprocess.run([cli_path, '-p', prompt, '--output-format', 'text'], capture_output=True, text=True, timeout=180)
        output = result.stdout.strip()
        skill_data = {"content": output}
        
        if output.startswith("---"):
            try:
                end = output.index("---", 3)
                for line in output[3:end].split("\n"):
                    if line.startswith("name:"): skill_data["name"] = line.split(":", 1)[1].strip()
                    elif line.startswith("description:"): skill_data["description"] = line.split(":", 1)[1].strip()
            except:
                pass
        
        return jsonify({"success": True, "skill": skill_data})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/claude/improve-skill', methods=['POST'])
def claude_improve_skill():
    data = request.json
    skill_name = data.get("skill_name", "")
    improvement_request = data.get("request", "")
    
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        return jsonify({"error": f"Skill '{skill_name}' not found"}), 404
    
    cli_path = find_claude_cli()
    if not cli_path:
        return jsonify({"error": "Claude Code CLI not found"}), 404
    
    current_content = skill_file.read_text(encoding="utf-8")
    prompt = f"""Improve this skill: {improvement_request}

Current SKILL.md:
{current_content}

Output the complete improved SKILL.md file only."""

    try:
        result = subprocess.run([cli_path, '-p', prompt, '--output-format', 'text'], capture_output=True, text=True, timeout=180)
        return jsonify({"success": True, "improved_content": result.stdout.strip(), "original_content": current_content})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timeout"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reload', methods=['POST'])
def reload_index():
    return jsonify({"success": True, "message": "Skills reloaded"})

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           Skills Manager API + Claude Code CLI               ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:5050                           ║
║  Skills:     {str(SKILLS_DIR):<44} ║
║  Claude CLI: {str(find_claude_cli() or 'Not found'):<44} ║
╚══════════════════════════════════════════════════════════════╝
""")
    app.run(port=5050, debug=True)
