# Skills Manager

A visual web interface for managing Claude MCP Skills with Claude Code CLI integration.

## Project Overview

This project provides a browser-based UI for managing skills in an MCP (Model Context Protocol) server. Skills are markdown-based instruction sets that Claude can load on-demand to gain specialized knowledge.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Skills Manager                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────────┐         ┌──────────────────────────┐    │
│   │  Claude Desktop  │         │     Browser UI           │    │
│   │  (MCP Client)    │         │  skills-manager.html     │    │
│   └────────┬─────────┘         └────────────┬─────────────┘    │
│            │                                │                   │
│            │ stdio/MCP                      │ HTTP REST         │
│            │                                │                   │
│   ┌────────▼─────────┐         ┌────────────▼─────────────┐    │
│   │   server.py      │         │  skills_manager_api.py   │    │
│   │   (MCP Server)   │         │  (Flask API :5050)       │    │
│   └────────┬─────────┘         └────────────┬─────────────┘    │
│            │                                │                   │
│            └────────────┬───────────────────┘                   │
│                         │                                       │
│                         ▼                                       │
│                  ┌──────────────┐                               │
│                  │   skills/    │                               │
│                  │  (folder)    │                               │
│                  └──────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
skills-mcp/
├── server.py                 # MCP server (FastMCP) - connects to Claude Desktop
├── skills_manager_api.py     # Flask HTTP API server (port 5050)
├── skills_manager_app.py     # Standalone all-in-one app (for .exe build)
├── skills-manager.html       # Web UI (single-file, Tailwind + Lucide)
├── requirements.txt          # Python dependencies
├── build.bat                 # Windows build script for .exe
├── skills/                   # Skills directory
│   ├── my-skill/
│   │   ├── SKILL.md          # Main skill content
│   │   ├── _meta.json        # Metadata (tags, description)
│   │   ├── scripts/          # Optional helper scripts
│   │   └── references/       # Optional reference docs
│   └── another-skill/
│       └── ...
├── dist/                     # Built executable + assets
│   ├── SkillsManager.exe
│   ├── skills-manager.html
│   └── README.md
└── .vscode/                  # VS Code configuration
    ├── settings.json
    └── launch.json
```

## Setup

### Prerequisites
- Python 3.10+
- Node.js (optional, for Claude Code CLI)
- Claude Code CLI (optional, for AI features)

### Installation

```bash
cd skills-mcp
pip install -r requirements.txt
```

### Running the API Server

```bash
python skills_manager_api.py
```

Opens at: http://localhost:5050

### Running the MCP Server (for Claude Desktop)

The MCP server runs automatically when Claude Desktop starts (configured in claude_desktop_config.json).

Manual test:
```bash
python server.py
```

## Development

### Key Files to Edit

| File | Purpose |
|------|---------|
| `skills-manager.html` | Frontend UI (vanilla JS, Tailwind CSS, Lucide icons) |
| `skills_manager_api.py` | Backend REST API (Flask) |
| `server.py` | MCP server for Claude Desktop integration |
| `skills_manager_app.py` | Standalone app (combines API + launcher for .exe) |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List all skills |
| GET | `/api/skills/<name>` | Get skill details |
| POST | `/api/skills` | Create new skill |
| PUT | `/api/skills/<name>` | Update skill |
| DELETE | `/api/skills/<name>` | Delete skill |
| POST | `/api/import/folder` | Import skill from folder path |
| POST | `/api/import/json` | Import files via JSON |
| GET | `/api/browse?path=` | Browse filesystem |
| GET | `/api/claude/status` | Check Claude CLI availability |
| POST | `/api/claude/run` | Run Claude with prompt |
| POST | `/api/claude/generate-skill` | Generate skill with AI |

### Frontend Structure

The UI is a single HTML file with embedded CSS and JavaScript:

- **Modals**: Import, Folder Browser, File Upload, Generate, View, Claude Console
- **State**: `skills[]`, `selectedFolderPath`, `browsePathCache{}`, etc.
- **Key Functions**:
  - `browsePath(path)` - Navigate filesystem
  - `importSelectedFolder()` - Copy folder to skills/
  - `uploadFiles()` - Upload files as new skill
  - `generateSkill()` - AI skill generation
  - `runConsoleCommand()` - Execute Claude prompts

### Building the Executable

```bash
# Windows
build.bat

# Or manually
pip install pyinstaller
python -m PyInstaller --onefile --name "SkillsManager" --console ^
    --add-data "skills-manager.html;." skills_manager_app.py
```

Output: `dist/SkillsManager.exe`

## Skill Format

### SKILL.md Structure

```markdown
---
name: skill-name
description: When Claude should use this skill
---

# Skill Name

## Overview
What this skill helps with.

## When to Use
- Trigger condition 1
- Trigger condition 2

## Quick Start
\`\`\`code
Example usage
\`\`\`

## Best Practices
- Practice 1
- Practice 2

## Examples
Practical examples here.
```

### _meta.json Structure

```json
{
  "name": "skill-name",
  "description": "One-line description",
  "tags": ["tag1", "tag2"],
  "sub_skills": [],
  "source": "imported"
}
```

## Claude Desktop Configuration

Location: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "skills": {
      "command": "python",
      "args": ["C:/Users/Bbeie/skills-mcp/server.py"]
    }
  }
}
```

## MCP Tools (for Claude)

The MCP server exposes these tools to Claude:

| Tool | Description |
|------|-------------|
| `list_skills()` | List all available skills |
| `get_skill(name)` | Load a skill's SKILL.md content |
| `search_skills(query)` | Search skills by metadata |
| `search_content(query)` | Full-text search across all skills |
| `get_skills_batch([...])` | Load multiple skills at once |
| `reload_index()` | Refresh skill index |
| `validate_skills()` | Check skill integrity |

## Known Issues / TODO

- [ ] Folder browser doesn't show drive letters on initial load (starts at root drives)
- [ ] No confirmation before overwriting existing skills
- [ ] File upload doesn't preserve folder structure from drag-drop
- [ ] Claude Console output doesn't syntax highlight
- [ ] No skill versioning or backup

## Tech Stack

- **Backend**: Python 3.11, Flask, Flask-CORS, FastMCP
- **Frontend**: Vanilla JS, Tailwind CSS (CDN), Lucide Icons (CDN)
- **Build**: PyInstaller
- **Protocol**: MCP (Model Context Protocol)
